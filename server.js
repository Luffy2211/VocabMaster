const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 连接SQLite数据库
const db = new sqlite3.Database(path.join(__dirname, 'vocabmaster.db'), (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    // 创建表
    initializeDatabase();
  }
});

// 初始化数据库表
function initializeDatabase() {
  // 创建单词表
  db.run(`CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    english TEXT NOT NULL UNIQUE,
    chinese TEXT NOT NULL,
    example TEXT,
    added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    familiarity INTEGER DEFAULT 0, -- 熟悉度：正确回答次数
    exposure INTEGER DEFAULT 0     -- 曝光度：被测试次数
  )`, (err) => {
    if (err) {
      console.error('Error creating words table:', err.message);
    }
  });

  // 创建错词表
  db.run(`CREATE TABLE IF NOT EXISTS mistakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER,
    mistake_count INTEGER DEFAULT 1,
    correct_streak INTEGER DEFAULT 0,
    added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) {
      console.error('Error creating mistakes table:', err.message);
    }
  });

  // 创建测试结果表
  db.run(`CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    score INTEGER NOT NULL,
    total_words INTEGER NOT NULL,
    correct_count INTEGER NOT NULL,
    incorrect_count INTEGER NOT NULL,
    type TEXT DEFAULT 'english-to-chinese-multiple',
    test_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating test_results table:', err.message);
    }
  });

  // 创建阅读文章表
  db.run(`CREATE TABLE IF NOT EXISTS reading_passages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    exposure INTEGER DEFAULT 0
  )`, (err) => {
    if (err) {
      console.error('Error creating reading_passages table:', err.message);
    }
  });

  // 创建阅读题目表
  db.run(`CREATE TABLE IF NOT EXISTS reading_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    FOREIGN KEY (passage_id) REFERENCES reading_passages(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) {
      console.error('Error creating reading_questions table:', err.message);
    }
  });
}

// API 路由

// 单词相关API

// 获取所有单词
app.get('/api/words', (req, res) => {
  db.all('SELECT * FROM words ORDER BY added_date DESC', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// 获取单词统计数据
app.get('/api/words/stats', (req, res) => {
  db.all('SELECT * FROM words', [], (err, words) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    const total_words_count = words.length;
    const tested_words_count = words.filter(word => word.exposure > 0).length;
    const familiar_words_count = words.filter(word => word.familiarity >= 3).length;

    const exposure_rate = total_words_count > 0 ? Math.round((tested_words_count / total_words_count) * 100) : 0;
    const familiarity_rate = total_words_count > 0 ? Math.round((familiar_words_count / total_words_count) * 100) : 0;

    res.status(200).json({
      total_words_count,
      tested_words_count,
      familiar_words_count,
      exposure_rate,
      familiarity_rate
    });
  });
});

// 获取单词总数
app.get('/api/words/count', (req, res) => {
  db.get('SELECT COUNT(*) AS count FROM words', [], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ count: row.count });
  });
});

// 获取单个单词
app.get('/api/words/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM words WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (row) {
      res.json(row);
    } else {
      res.status(404).json({ error: 'Word not found' });
    }
  });
});

// 添加单词
app.post('/api/words', (req, res) => {
  const { english, chinese, example } = req.body;
  
  if (!english || !chinese) {
    res.status(400).json({ error: 'English and Chinese are required' });
    return;
  }

  // 检查单词是否已存在
  db.get('SELECT * FROM words WHERE LOWER(english) = LOWER(?)', [english], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (row) {
      // 单词已存在，返回提示信息
      res.status(409).json({
        error: 'Word already exists',
        existingWord: row
      });
      return;
    }

    // 添加新单词
    db.run(
      'INSERT INTO words (english, chinese, example) VALUES (?, ?, ?)',
      [english, chinese, example],
      function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.json({
          id: this.lastID,
          english,
          chinese,
          example,
          added_date: new Date().toISOString()
        });
      }
    );
  });
});

// 批量添加单词
app.post('/api/words/batch', (req, res) => {
  const words = req.body;
  const results = {
    success: [],
    error: [],
    duplicate: []
  };

  if (!Array.isArray(words)) {
    res.status(400).json({ error: 'Request body must be an array of words' });
    return;
  }

  // 开始事务处理批量添加
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    const promises = words.map((word, index) => {
      return new Promise((resolve) => {
        const { english, chinese, example } = word;
        
        if (!english || !chinese) {
          results.error.push({ index, word, reason: 'English and Chinese are required' });
          resolve();
          return;
        }

        // 检查单词是否已存在
        db.get('SELECT * FROM words WHERE LOWER(english) = LOWER(?)', [english], (err, row) => {
          if (err) {
            results.error.push({ index, word, reason: err.message });
            resolve();
            return;
          }

          if (row) {
            // 单词已存在
            results.duplicate.push({ index, word, existingWord: row });
            resolve();
            return;
          }

          // 添加新单词
          db.run(
            'INSERT INTO words (english, chinese, example) VALUES (?, ?, ?)',
            [english, chinese, example],
            function(err) {
              if (err) {
                results.error.push({ index, word, reason: err.message });
              } else {
                results.success.push({
                  id: this.lastID,
                  english,
                  chinese,
                  example
                });
              }
              resolve();
            }
          );
        });
      });
    });

    Promise.all(promises).then(() => {
      db.run('COMMIT', (err) => {
        if (err) {
          db.run('ROLLBACK');
          res.status(500).json({ error: 'Transaction failed', details: results });
        } else {
          res.json(results);
        }
      });
    });
  });
});

// 更新单词
app.put('/api/words/:id', (req, res) => {
  const { id } = req.params;
  const { english, chinese, example } = req.body;

  if (!english || !chinese) {
    res.status(400).json({ error: 'English and Chinese are required' });
    return;
  }

  db.run(
    'UPDATE words SET english = ?, chinese = ?, example = ? WHERE id = ?',
    [english, chinese, example, id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes > 0) {
        res.json({ id: parseInt(id), english, chinese, example });
      } else {
        res.status(404).json({ error: 'Word not found' });
      }
    }
  );
});

// 删除单词
app.delete('/api/words/:id', (req, res) => {
  const { id } = req.params;
  
  db.run('DELETE FROM words WHERE id = ?', [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes > 0) {
      res.json({ message: 'Word deleted successfully' });
    } else {
      res.status(404).json({ error: 'Word not found' });
    }
  });
});

// 批量删除单词
app.delete('/api/words/batch/:ids', (req, res) => {
  const { ids } = req.params;
  const idArray = ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));

  if (idArray.length === 0) {
    res.status(400).json({ error: 'No valid IDs provided' });
    return;
  }

  const placeholders = idArray.map(() => '?').join(',');
  
  db.run(`DELETE FROM words WHERE id IN (${placeholders})`, idArray, function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: `Deleted ${this.changes} words successfully` });
  });
});

// 清空单词表
app.delete('/api/words', (req, res) => {
  db.run('DELETE FROM words', function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'All words deleted successfully' });
  });
});

// 搜索单词
app.get('/api/words/search/:query', (req, res) => {
  const { query } = req.params;
  
  db.all(
    `SELECT * FROM words 
     WHERE LOWER(english) LIKE ? OR LOWER(chinese) LIKE ? OR LOWER(example) LIKE ?`,
    [`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 获取随机单词用于测试
app.get('/api/test/random/:count', (req, res) => {
  const { count } = req.params;
  
  db.all(
    'SELECT * FROM words ORDER BY RANDOM() LIMIT ?',
    [parseInt(count)],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 获取随机中文释义用于干扰项
app.get('/api/test/distractors/:wordId/:count', (req, res) => {
  const { wordId, count } = req.params;
  
  db.all(
    `SELECT chinese FROM words 
     WHERE id != ? 
     ORDER BY RANDOM() 
     LIMIT ?`,
    [parseInt(wordId), parseInt(count)],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows.map(row => row.chinese));
    }
  );
});

// 错词相关API

// 获取所有错词
app.get('/api/mistakes', (req, res) => {
  db.all(
    `SELECT m.*, w.english, w.chinese, w.example 
     FROM mistakes m 
     JOIN words w ON m.word_id = w.id 
     ORDER BY m.added_date DESC`,
    [],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 添加错词
app.post('/api/mistakes', (req, res) => {
  const { word_id } = req.body;
  
  if (!word_id) {
    res.status(400).json({ error: 'Word ID is required' });
    return;
  }

  // 检查错词是否已存在
  db.get('SELECT * FROM mistakes WHERE word_id = ?', [word_id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (row) {
      // 错词已存在，增加错误计数
      db.run(
        'UPDATE mistakes SET mistake_count = mistake_count + 1, correct_streak = 0 WHERE id = ?',
        [row.id],
        function(err) {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({ id: row.id, word_id, mistake_count: row.mistake_count + 1, correct_streak: 0 });
        }
      );
    } else {
      // 添加新错词
      db.run(
        'INSERT INTO mistakes (word_id) VALUES (?)',
        [word_id],
        function(err) {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({ id: this.lastID, word_id, mistake_count: 1, correct_streak: 0 });
        }
      );
    }
  });
});

// 记录正确答案
app.post('/api/mistakes/correct/:wordId', (req, res) => {
  const { wordId } = req.params;
  
  // 查找错词
  db.get('SELECT * FROM mistakes WHERE word_id = ?', [wordId], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (row) {
      // 增加正确连续计数
      const updatedStreak = row.correct_streak + 1;
      
      if (updatedStreak >= 2) {
        // 连续答对2次，从错词表中移除
        db.run('DELETE FROM mistakes WHERE id = ?', [row.id], function(err) {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({ message: 'Word removed from mistakes list' });
        });
      } else {
        // 更新正确连续计数
        db.run(
          'UPDATE mistakes SET correct_streak = ? WHERE id = ?',
          [updatedStreak, row.id],
          function(err) {
            if (err) {
              res.status(500).json({ error: err.message });
              return;
            }
            res.json({ id: row.id, word_id: row.word_id, mistake_count: row.mistake_count, correct_streak: updatedStreak });
          }
        );
      }
    } else {
      res.status(404).json({ error: 'Mistake not found' });
    }
  });
});

// 删除单个错词
app.delete('/api/mistakes/:id', (req, res) => {
  const { id } = req.params;
  
  db.run('DELETE FROM mistakes WHERE id = ?', [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Mistake not found' });
      return;
    }
    res.json({ message: 'Mistake deleted successfully' });
  });
});

// 清空错词表
app.delete('/api/mistakes', (req, res) => {
  db.run('DELETE FROM mistakes', function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'All mistakes deleted successfully' });
  });
});

// 测试结果相关API

// 获取所有测试结果
app.get('/api/test-results', (req, res) => {
  db.all('SELECT * FROM test_results ORDER BY test_date DESC', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// 保存测试结果
app.post('/api/test-results', (req, res) => {
  const { score, total_words, correct_count, incorrect_count, type = 'english-to-chinese-multiple' } = req.body;
  
  if (score === undefined || total_words === undefined || correct_count === undefined || incorrect_count === undefined) {
    res.status(400).json({ error: 'All test result fields are required' });
    return;
  }

  db.run(
    'INSERT INTO test_results (score, total_words, correct_count, incorrect_count, type) VALUES (?, ?, ?, ?, ?)',
    [score, total_words, correct_count, incorrect_count, type],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({
        id: this.lastID,
        score,
        total_words,
        correct_count,
        incorrect_count,
        type,
        test_date: new Date().toISOString()
      });
    }
  );
});

// 删除单个测试结果
app.delete('/api/test-results/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM test_results WHERE id = ?', [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Test result not found' });
      return;
    }
    res.json({ message: 'Test result deleted successfully' });
  });
});

// 清空测试结果
app.delete('/api/test-results', (req, res) => {
  db.run('DELETE FROM test_results', function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'All test results deleted successfully' });
  });
});

// 获取测试活动日历数据
app.get('/api/test-activity', (req, res) => {
  // 获取过去100天的测试活动数据
  db.all(
    `SELECT DATE(test_date) as date, COUNT(*) as count 
     FROM test_results 
     WHERE test_date >= DATE('now', '-100 days') 
     GROUP BY DATE(test_date)`,
    [],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 更新单词熟悉度和曝光度
app.post('/api/words/:id/update-stats', (req, res) => {
  const wordId = req.params.id;
  const { isCorrect } = req.body;

  // 事务处理，确保数据一致性
  db.run('BEGIN TRANSACTION');

  // 更新曝光度
  db.run('UPDATE words SET exposure = exposure + 1 WHERE id = ?', [wordId], (err) => {
    if (err) {
      db.run('ROLLBACK');
      res.status(500).json({ error: err.message });
      return;
    }

    // 如果答案正确，更新熟悉度
    if (isCorrect) {
      db.run('UPDATE words SET familiarity = familiarity + 1 WHERE id = ?', [wordId], (err) => {
        if (err) {
          db.run('ROLLBACK');
          res.status(500).json({ error: err.message });
          return;
        }

        db.run('COMMIT');
        res.status(200).json({ success: true });
      });
    } else {
      db.run('COMMIT');
      res.status(200).json({ success: true });
    }
  });
});



// 导入初始单词数据
app.post('/api/import-initial-words', (req, res) => {
  const words = req.body;
  
  if (!Array.isArray(words)) {
    res.status(400).json({ error: 'Request body must be an array of words' });
    return;
  }

  // 开始事务处理批量添加
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    const promises = words.map((word) => {
      return new Promise((resolve) => {
        const { english, chinese, example } = word;
        
        if (!english || !chinese) {
          resolve();
          return;
        }

        // 检查单词是否已存在
        db.get('SELECT * FROM words WHERE LOWER(english) = LOWER(?)', [english], (err, row) => {
          if (err || row) {
            resolve();
            return;
          }

          // 添加新单词
          db.run(
            'INSERT INTO words (english, chinese, example) VALUES (?, ?, ?)',
            [english, chinese, example],
            function() {
              resolve();
            }
          );
        });
      });
    });

    Promise.all(promises).then(() => {
      db.run('COMMIT', (err) => {
        if (err) {
          db.run('ROLLBACK');
          res.status(500).json({ error: 'Transaction failed' });
        } else {
          res.json({ message: 'Initial words imported successfully' });
        }
      });
    });
  });
});

// 阅读理解相关API

// 获取所有阅读文章列表
app.get('/api/reading-passages', (req, res) => {
  db.all('SELECT id, title, content, added_date, exposure FROM reading_passages ORDER BY added_date DESC', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// 导入阅读理解题目
app.post('/api/reading/import', (req, res) => {
  const { content } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: '内容不能为空' });
  }

  // 解析输入内容 - 允许分隔符前后有空格
  const contentParts = content.split(/\s*阅读文本\s*|\s*选择题\s*|\s*答案\s*/);
  if (contentParts.length < 4) {
    return res.status(400).json({ error: '格式错误：请确保包含阅读文本、选择题和答案三个部分' });
  }

  const passageContent = contentParts[1].trim();
  const questionsText = contentParts[2].trim();
  const answersText = contentParts[3].trim();

  // 提取标题和正文 - 提供更详细的阅读文本错误信息
  const lines = passageContent.split('\n');
  if (lines.length < 1) {
    return res.status(400).json({ error: '阅读文本部分格式错误：阅读文本不能为空' });
  }
  const title = lines[0].trim();
  if (!title) {
    return res.status(400).json({ error: '阅读文本部分格式错误：请确保第一行为有效的标题' });
  }
  const actualContent = lines.slice(1).join('\n').trim();
  if (!actualContent) {
    return res.status(400).json({ error: '阅读文本部分格式错误：请确保标题后有正文内容' });
  }

  // 解析题目 - 更健壮的正则表达式，允许选项后的空格和换行
  const questions = [];
  const questionRegex = /(\d+)[.、]\s*(.*?)\s*A[.、]\s*(.*?)\s*B[.、]\s*(.*?)\s*C[.、]\s*(.*?)(?=\d+[.、]|$)/gs;
  let match;
  
  try {
    while ((match = questionRegex.exec(questionsText)) !== null) {
      questions.push({
        questionText: match[2].trim(),
        optionA: match[3].trim(),
        optionB: match[4].trim(),
        optionC: match[5].trim()
      });
    }
  } catch (err) {
    return res.status(400).json({ error: '选择题部分格式错误：请确保题目格式正确' });
  }

  if (questions.length === 0) {
    return res.status(400).json({ error: '选择题部分格式错误：没有找到有效的选择题，请检查题目编号和选项格式' });
  }

  // 验证题目内容完整性
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.questionText) {
      return res.status(400).json({ error: `选择题部分格式错误：第${i+1}题题目内容不能为空` });
    }
    if (!q.optionA || !q.optionB || !q.optionC) {
      return res.status(400).json({ error: `选择题部分格式错误：第${i+1}题选项不完整，请确保包含A、B、C三个选项` });
    }
  }

  // 解析答案 - 更健壮的正则表达式，允许答案后的空格和换行
  const answers = {};
  const answerRegex = /(\d+)\s*[.、]\s*([ABC])\s*/g;
  let answerErrors = [];
  
  try {
    while ((match = answerRegex.exec(answersText)) !== null) {
      const questionNum = match[1];
      const option = match[2];
      
      if (!['A', 'B', 'C'].includes(option)) {
        answerErrors.push(`第${questionNum}题答案不是有效的选项(A/B/C)`);
      }
      answers[questionNum] = option;
    }
  } catch (err) {
    return res.status(400).json({ error: '答案部分格式错误：请确保答案格式正确' });
  }

  if (Object.keys(answers).length === 0) {
    return res.status(400).json({ error: '答案部分格式错误：没有找到有效的答案，请检查答案格式（如：1. A）' });
  }

  if (answerErrors.length > 0) {
    return res.status(400).json({ error: `答案部分格式错误：${answerErrors.join('，')}` });
  }

  // 验证题目和答案数量是否一致
  if (questions.length !== Object.keys(answers).length) {
    return res.status(400).json({ error: `格式错误：题目数量(${questions.length})和答案数量(${Object.keys(answers).length})不匹配` });
  }

  // 验证每个题目都有对应的答案
  for (let i = 0; i < questions.length; i++) {
    const questionNum = (i + 1).toString();
    if (!answers[questionNum]) {
      return res.status(400).json({ error: `答案部分格式错误：缺少第${questionNum}题的答案` });
    }
  }

  // 开始事务
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // 插入文章
    db.run('INSERT INTO reading_passages (title, content) VALUES (?, ?)', [title, actualContent], function(err) {
      if (err) {
        db.run('ROLLBACK TRANSACTION');
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res.status(500).json({ error: '系统错误：该阅读文章已存在' });
        }
        return res.status(500).json({ error: '系统错误：数据库操作失败，请稍后重试' });
      }

      const passageId = this.lastID;
      let successCount = 0;
      let failedCount = 0;

      // 插入每个题目
      questions.forEach((q, index) => {
        const questionNum = (index + 1).toString();
        const correctAnswer = answers[questionNum];

        if (!correctAnswer) {
          failedCount++;
          return;
        }

        db.run(
          'INSERT INTO reading_questions (passage_id, question_text, option_a, option_b, option_c, correct_answer) VALUES (?, ?, ?, ?, ?, ?)',
          [passageId, q.questionText, q.optionA, q.optionB, q.optionC, correctAnswer],
          (err) => {
            if (err) {
              failedCount++;
            } else {
              successCount++;
            }
          }
        );
      });

      // 提交事务并响应
      db.run('COMMIT TRANSACTION', () => {
        res.json({
          success_count: 1, // 成功导入的文章数量
          total_questions: successCount // 成功导入的题目总数
        });
      });
    });
  });
});

// 获取所有阅读文章列表
app.get('/api/reading/passages', (req, res) => {
  db.all('SELECT id, title, added_date, exposure FROM reading_passages ORDER BY added_date DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: '获取文章列表失败: ' + err.message });
    }
    res.json(rows);
  });
});

// 获取所有阅读文章列表 - 兼容前端调用路径
app.get('/api/reading-passages', (req, res) => {
  db.all('SELECT id, title, added_date, exposure FROM reading_passages ORDER BY added_date DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: '获取文章列表失败: ' + err.message });
    }
    res.json(rows);
  });
});

// 获取指定文章及其题目
app.get('/api/reading/passage/:id', (req, res) => {
  const { id } = req.params;
  
  db.serialize(() => {
    // 获取文章信息
    db.get('SELECT * FROM reading_passages WHERE id = ?', [id], (err, passage) => {
      if (err) {
        return res.status(500).json({ error: '获取文章失败: ' + err.message });
      }
      if (!passage) {
        return res.status(404).json({ error: '找不到指定的文章' });
      }

      // 获取题目
      db.all('SELECT * FROM reading_questions WHERE passage_id = ?', [id], (err, questions) => {
        if (err) {
          return res.status(500).json({ error: '获取题目失败: ' + err.message });
        }

        // 更新文章的曝光度
        db.run('UPDATE reading_passages SET exposure = exposure + 1 WHERE id = ?', [id]);

        res.json({
          passage,
          questions
        });
      });
    });
  });
});

// 前端兼容端点 - 用于匹配前端代码中调用的URL
app.get('/api/reading-passages/:id', (req, res) => {
  const { id } = req.params;
  
  db.serialize(() => {
    // 获取文章信息
    db.get('SELECT * FROM reading_passages WHERE id = ?', [id], (err, passage) => {
      if (err) {
        return res.status(500).json({ error: '获取文章失败: ' + err.message });
      }
      if (!passage) {
        return res.status(404).json({ error: '找不到指定的文章' });
      }

      // 获取题目
      db.all('SELECT * FROM reading_questions WHERE passage_id = ?', [id], (err, questions) => {
        if (err) {
          return res.status(500).json({ error: '获取题目失败: ' + err.message });
        }

        // 更新文章的曝光度
        db.run('UPDATE reading_passages SET exposure = exposure + 1 WHERE id = ?', [id]);

        // 返回扁平化的数据结构，与前端期望的格式匹配
        res.json({
          id: passage.id,
          title: passage.title,
          content: passage.content,
          added_date: passage.added_date,
          exposure: passage.exposure,
          questions: questions
        });
      });
    });
  });
});

// 提交答案并计算得分
app.post('/api/reading/submit-answers', (req, res) => {
  const { passageId, answers } = req.body;

  if (!passageId || !answers) {
    return res.status(400).json({ error: '缺少必要的参数' });
  }

  // 获取正确答案
  db.all('SELECT id, correct_answer FROM reading_questions WHERE passage_id = ?', [passageId], (err, correctAnswers) => {
    if (err) {
      return res.status(500).json({ error: '获取正确答案失败: ' + err.message });
    }

    // 计算得分
    let correctCount = 0;
    const results = [];

    correctAnswers.forEach((q) => {
      const userAnswer = answers[q.id];
      const isCorrect = userAnswer && userAnswer.toUpperCase() === q.correct_answer.toUpperCase();
      
      if (isCorrect) {
        correctCount++;
      }

      results.push({
        questionId: q.id,
        userAnswer,
        correctAnswer: q.correct_answer,
        isCorrect
      });
    });

    const totalQuestions = correctAnswers.length;
    const score = Math.round((correctCount / totalQuestions) * 100);

    // 保存测试结果
    db.run(
      'INSERT INTO test_results (score, total_words, correct_count, incorrect_count, type) VALUES (?, ?, ?, ?, ?)',
      [score, totalQuestions, correctCount, totalQuestions - correctCount, 'reading-comprehension'],
      (err) => {
        if (err) {
          console.error('保存测试结果失败:', err.message);
        }

        res.json({
          success: true,
          score,
          correctCount,
          totalQuestions,
          results: results
        });
      }
    );
  });
});

// 提交答案并计算得分 - 兼容前端调用路径
app.post('/api/reading-passages/:id/submit-answers', (req, res) => {
  const { id } = req.params;
  const { answers, passage_id } = req.body;

  // 优先使用请求体中的passage_id，如果不存在则使用路径参数id
  const passageId = passage_id || id;

  if (!passageId || !answers) {
    return res.status(400).json({ error: '缺少必要的参数' });
  }

  // 获取正确答案
  db.all('SELECT id, correct_answer FROM reading_questions WHERE passage_id = ?', [passageId], (err, correctAnswers) => {
    if (err) {
      return res.status(500).json({ error: '获取正确答案失败: ' + err.message });
    }

    // 计算得分
    let correctCount = 0;
    const results = [];

    correctAnswers.forEach((q) => {
      const userAnswer = answers[q.id];
      const isCorrect = userAnswer && userAnswer.toUpperCase() === q.correct_answer.toUpperCase();
      
      if (isCorrect) {
        correctCount++;
      }

      results.push({
        questionId: q.id,
        userAnswer,
        correctAnswer: q.correct_answer,
        isCorrect
      });
    });

    const totalQuestions = correctAnswers.length;
    const score = Math.round((correctCount / totalQuestions) * 100);

    // 保存测试结果
    db.run(
      'INSERT INTO test_results (score, total_words, correct_count, incorrect_count, type) VALUES (?, ?, ?, ?, ?)',
      [score, totalQuestions, correctCount, totalQuestions - correctCount, 'reading-comprehension'],
      (err) => {
        if (err) {
          console.error('保存测试结果失败:', err.message);
        }

        res.json({
          success: true,
          score,
          correctCount,
          totalQuestions,
          results: results
        });
      }
    );
  });
});

// 提供静态文件服务 (放在所有路由后面)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`VocabMaster server is running on port ${PORT}`);
});

// 优雅关闭数据库连接
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Closed the database connection.');
    }
    process.exit(0);
  });
});