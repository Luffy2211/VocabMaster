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
    added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    test_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating test_results table:', err.message);
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
  const { score, total_words, correct_count, incorrect_count } = req.body;
  
  if (score === undefined || total_words === undefined || correct_count === undefined || incorrect_count === undefined) {
    res.status(400).json({ error: 'All test result fields are required' });
    return;
  }

  db.run(
    'INSERT INTO test_results (score, total_words, correct_count, incorrect_count) VALUES (?, ?, ?, ?)',
    [score, total_words, correct_count, incorrect_count],
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

// 提供静态文件服务
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
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