const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
//不要改动端口
const PORT = process.env.PORT || 3003;

// 使用中间件
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 添加CORS支持
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// 连接数据库
const db = new sqlite3.Database('./vocab.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    // 初始化数据库表
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
    familiarity INTEGER DEFAULT 0,
    exposure INTEGER DEFAULT 0,
    added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating words table:', err.message);
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

  // 创建阅读问题表
  db.run(`CREATE TABLE IF NOT EXISTS reading_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL,
    question TEXT NOT NULL,
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
  
  // 创建句子表
  db.run(`CREATE TABLE IF NOT EXISTS sentences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence TEXT NOT NULL,
    answers TEXT NOT NULL,
    added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    exposure INTEGER DEFAULT 0
  )`, (err) => {
    if (err) {
      console.error('Error creating sentences table:', err.message);
    }
  });
  
  // 创建错词表
  db.run(`CREATE TABLE IF NOT EXISTS mistakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    mistake_count INTEGER DEFAULT 1,
    last_mistake_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
    total_questions INTEGER NOT NULL,
    test_type TEXT NOT NULL,
    test_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating test_results table:', err.message);
    }
  });
  
  // 为错词表添加单词ID的唯一索引
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mistakes_word_id ON mistakes(word_id)`, (err) => {
    if (err) {
      console.error('Error creating index on mistakes table:', err.message);
    }
  });
}

// API 路由

// 单词相关API

// 获取测试用的随机单词
app.get('/api/test/random/:count', (req, res) => {
  const count = parseInt(req.params.count);
  
  if (isNaN(count) || count <= 0) {
    res.status(400).json({ error: '无效的单词数量' });
    return;
  }
  
  // 随机选择指定数量的单词
  db.all(
    'SELECT id, english, chinese, example FROM words ORDER BY RANDOM() LIMIT ?',
    [count],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 获取干扰选项
app.get('/api/test/distractors/:id/:count', (req, res) => {
  const { id, count } = req.params;
  
  // 获取与指定ID不同的单词作为干扰选项
  db.all(
    'SELECT id, english, chinese FROM words WHERE id != ? ORDER BY RANDOM() LIMIT ?',
    [id, count],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 获取单词总数
app.get('/api/words/count', (req, res) => {
  db.get('SELECT COUNT(*) as total FROM words', [], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ total: row.total });
  });
});

// 获取所有单词
app.get('/api/words', (req, res) => {
  db.all('SELECT id, english, chinese, example, added_date FROM words ORDER BY added_date DESC', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// 获取单个单词详情
app.get('/api/words/:id', (req, res) => {
  const id = req.params.id;
  
  db.get('SELECT id, english, chinese, example FROM words WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: '单词不存在' });
      return;
    }
    res.json(row);
  });
});

// 添加单词
app.post('/api/words', (req, res) => {
  const { english, chinese, example } = req.body;
  
  if (!english || !chinese) {
    res.status(400).json({ error: '英文单词和中文释义不能为空' });
    return;
  }
  
  db.run(
    'INSERT INTO words (english, chinese, example) VALUES (?, ?, ?)',
    [english, chinese, example || ''],
    function(err) {
      if (err) {
        // 检查是否是唯一约束冲突（单词重复）
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          res.status(409).json({ error: '该单词已存在' });
        } else {
          res.status(500).json({ error: err.message });
        }
        return;
      }
      
      res.status(201).json({
        id: this.lastID,
        english,
        chinese,
        example,
        message: '单词添加成功'
      });
    }
  );
});

// 更新单词
app.put('/api/words/:id', (req, res) => {
  const id = req.params.id;
  const { english, chinese, example } = req.body;
  
  if (!english || !chinese) {
    res.status(400).json({ error: '英文单词和中文释义不能为空' });
    return;
  }
  
  // 检查更新后的单词是否与其他单词重复
  db.get('SELECT id FROM words WHERE english = ? AND id != ?', [english, id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (row) {
      res.status(409).json({ error: '该单词已存在' });
      return;
    }
    
    // 执行更新
    db.run(
      'UPDATE words SET english = ?, chinese = ?, example = ? WHERE id = ?',
      [english, chinese, example || '', id],
      function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        
        if (this.changes === 0) {
          res.status(404).json({ error: '单词不存在' });
          return;
        }
        
        res.json({
          id,
          english,
          chinese,
          example,
          message: '单词更新成功'
        });
      }
    );
  });
});

// 删除单词
app.delete('/api/words/:id', (req, res) => {
  const id = req.params.id;
  
  db.run('DELETE FROM words WHERE id = ?', [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (this.changes === 0) {
      res.status(404).json({ error: '单词不存在' });
      return;
    }
    
    res.json({ message: '单词删除成功' });
  });
});

// 批量删除单词
app.post('/api/words/batch-delete', (req, res) => {
  const { ids } = req.body;
  
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: '请提供要删除的单词ID列表' });
    return;
  }
  
  const placeholders = ids.map(() => '?').join(',');
  
  db.run(
    `DELETE FROM words WHERE id IN (${placeholders})`,
    ids,
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      res.json({ 
        message: `成功删除 ${this.changes} 个单词` 
      });
    }
  );
});

// 批量添加单词
app.post('/api/words/batch', (req, res) => {
  const words = req.body;
  
  if (!Array.isArray(words) || words.length === 0) {
    res.status(400).json({ error: '请提供要添加的单词列表' });
    return;
  }
  
  // 开始事务
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    const stmt = db.prepare('INSERT OR IGNORE INTO words (english, chinese, example) VALUES (?, ?, ?)');
    
    words.forEach(word => {
      if (word.english && word.chinese) {
        stmt.run(word.english, word.chinese, word.example || '');
      }
    });
    
    stmt.finalize();
    db.run('COMMIT');
    
    res.json({ message: '批量添加单词完成' });
  });
});

// 更新单词统计信息
app.post('/api/words/:id/update-stats', (req, res) => {
  const id = req.params.id;
  const { isCorrect } = req.body;
  
  // 增加曝光度，根据是否正确调整熟悉度
  const familiarityChange = isCorrect ? 1 : -1;
  
  db.run(
    'UPDATE words SET exposure = exposure + 1, familiarity = familiarity + ? WHERE id = ?',
    [familiarityChange, id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      if (this.changes === 0) {
        res.status(404).json({ error: '单词不存在' });
        return;
      }
      
      res.json({ message: '单词统计信息更新成功' });
    }
  );
});

// 获取单词统计数据
app.get('/api/words/stats', (req, res) => {
  db.get('SELECT COUNT(*) as total, AVG(familiarity) as avg_familiarity, AVG(exposure) as avg_exposure FROM words', [], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row);
  });
});

// 清空所有单词
app.delete('/api/words', (req, res) => {
  db.run('DELETE FROM words', function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    res.json({ message: '所有单词已清空' });
  });
});

// 句子相关API

// 获取所有句子
app.get('/api/sentences', (req, res) => {
  db.all('SELECT id, sentence, answers, added_date FROM sentences ORDER BY added_date DESC', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// 获取单个句子详情
app.get('/api/sentences/:id', (req, res) => {
  const id = req.params.id;
  
  db.get('SELECT id, sentence, answers FROM sentences WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: '句子不存在' });
      return;
    }
    res.json(row);
  });
});

// 保存新句子
app.post('/api/sentences', (req, res) => {
  const { sentence, answers } = req.body;
  
  if (!sentence || !answers) {
    res.status(400).json({ error: '句子和答案不能为空' });
    return;
  }
  
  db.run(
    'INSERT INTO sentences (sentence, answers) VALUES (?, ?)',
    [sentence, answers],
    function(err) {
      if (err) {
        // 检查是否是唯一约束冲突（句子重复）
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          res.status(409).json({ error: '该句子已存在' });
        } else {
          res.status(500).json({ error: err.message });
        }
        return;
      }
      
      res.status(201).json({
        id: this.lastID,
        sentence,
        answers,
        message: '句子添加成功'
      });
    }
  );
});

// 更新句子
app.put('/api/sentences/:id', (req, res) => {
  const id = req.params.id;
  const { sentence, answers } = req.body;
  
  if (!sentence || !answers) {
    res.status(400).json({ error: '句子和答案不能为空' });
    return;
  }
  
  db.run(
    'UPDATE sentences SET sentence = ?, answers = ? WHERE id = ?',
    [sentence, answers, id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      if (this.changes === 0) {
        res.status(404).json({ error: '句子不存在' });
        return;
      }
      
      res.json({
        id,
        sentence,
        answers,
        message: '句子更新成功'
      });
    }
  );
});

// 删除单个句子
app.delete('/api/sentences/:id', (req, res) => {
  const id = req.params.id;
  
  db.run('DELETE FROM sentences WHERE id = ?', [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (this.changes === 0) {
      res.status(404).json({ error: '句子不存在' });
      return;
    }
    
    res.json({ message: '句子删除成功' });
  });
});

// 批量删除句子
app.post('/api/sentences/batch-delete', (req, res) => {
  const { ids } = req.body;
  
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: '请提供要删除的句子ID列表' });
    return;
  }
  
  const placeholders = ids.map(() => '?').join(',');
  
  db.run(
    `DELETE FROM sentences WHERE id IN (${placeholders})`,
    ids,
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      res.json({ 
        message: `成功删除 ${this.changes} 个句子` 
      });
    }
  );
});

// 清空所有句子
app.delete('/api/sentences', (req, res) => {
  db.run('DELETE FROM sentences', function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    res.json({ message: '所有句子已清空' });
  });
});

// 错词相关API

// 获取所有错词
app.get('/api/mistakes', (req, res) => {
  db.all(
    `SELECT m.id, w.id as word_id, w.english, w.chinese, w.example, m.mistake_count 
     FROM mistakes m 
     JOIN words w ON m.word_id = w.id 
     ORDER BY m.id DESC`,
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

// 注意：上面的路由已包含获取错词列表的功能

// 添加错词
app.post('/api/mistakes', (req, res) => {
  const { word_id } = req.body;
  
  if (!word_id) {
    res.status(400).json({ error: '单词ID不能为空' });
    return;
  }
  
  // 检查错词是否已存在
  db.get('SELECT id FROM mistakes WHERE word_id = ?', [word_id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (row) {
      // 已存在，更新错误次数
      db.run(
        'UPDATE mistakes SET mistake_count = mistake_count + 1 WHERE word_id = ?',
        [word_id],
        (err) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.status(200).json({ message: '错词更新成功' });
        }
      );
    } else {
      // 不存在，创建新记录
      db.run(
        'INSERT INTO mistakes (word_id, mistake_count) VALUES (?, 1)',
        [word_id],
        function(err) {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.status(201).json({ id: this.lastID, message: '错词添加成功' });
        }
      );
    }
  });
});

// 正确回答错词
app.post('/api/mistakes/correct/:wordId', (req, res) => {
  const wordId = req.params.wordId;
  
  // 检查错词并更新状态
  db.get('SELECT mistake_count FROM mistakes WHERE word_id = ?', [wordId], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (!row) {
      res.status(404).json({ error: '错词不存在' });
      return;
    }
    
    const newCount = row.mistake_count - 1;
    
    if (newCount <= 0) {
      // 错误次数归零，从错词库中删除
      db.run('DELETE FROM mistakes WHERE word_id = ?', [wordId], (err) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.json({ message: '错词已从错词库中移除' });
      });
    } else {
      // 更新错误次数
      db.run(
        'UPDATE mistakes SET mistake_count = ? WHERE word_id = ?',
        [newCount, wordId],
        (err) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({ message: '错词状态更新成功' });
        }
      );
    }
  });
});

// 删除错词
app.delete('/api/mistakes/:id', (req, res) => {
  const id = req.params.id;
  
  db.run('DELETE FROM mistakes WHERE id = ?', [id], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: '错词删除成功' });
  });
});

// 清空所有错词
app.delete('/api/mistakes', (req, res) => {
  db.run('DELETE FROM mistakes', (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: '所有错词已清空' });
  });
});

// 测试结果相关API

// 保存测试结果
app.post('/api/test-results', (req, res) => {
  const { score, totalWords, type } = req.body;
  
  // 根据数据库结构，我们还需要计算correct_count和incorrect_count
  const correctCount = score;
  const incorrectCount = totalWords - score;
  
  if (score === undefined || totalWords === undefined || !type) {
    res.status(400).json({ error: '缺少必要的测试结果数据' });
    return;
  }
  
  db.run(
    'INSERT INTO test_results (score, total_words, correct_count, incorrect_count, type, test_date) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
    [score, totalWords, correctCount, incorrectCount, type],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.status(201).json({ id: this.lastID, message: '测试结果保存成功' });
    }
  );
});

// 获取所有测试结果
app.get('/api/test-results', (req, res) => {
  db.all(
    'SELECT id, score, total_words, correct_count, incorrect_count, type, test_date FROM test_results ORDER BY test_date DESC',
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

// 删除测试结果
app.delete('/api/test-results/:id', (req, res) => {
  const id = req.params.id;
  
  db.run('DELETE FROM test_results WHERE id = ?', [id], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: '测试结果删除成功' });
  });
});

// 清空所有测试结果
app.delete('/api/test-results', (req, res) => {
  db.run('DELETE FROM test_results', (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: '所有测试结果已清空' });
  });
});

// 配置静态文件服务 - 必须放在所有API路由之后
app.use(express.static(path.join(__dirname, 'public')));

// 前端路由处理 - 捕获所有非API请求，返回index.html以支持SPA应用
// 这个路由必须放在所有其他路由的最后
app.get('*', (req, res) => {
  // 只有当请求不是API请求时才返回HTML文件
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    // 对于未匹配的API请求，返回404错误
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

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