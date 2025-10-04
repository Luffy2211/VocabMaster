const sqlite3 = require('sqlite3').verbose();

// 连接数据库
const db = new sqlite3.Database('./vocabmaster.db', (err) => {
  if (err) {
    console.error('无法连接到数据库:', err.message);
    process.exit(1);
  }
  console.log('成功连接到SQLite数据库。');
});

// 添加exposure列
function addExposureColumn() {
  return new Promise((resolve, reject) => {
    db.run('ALTER TABLE words ADD COLUMN exposure INTEGER DEFAULT 0', (err) => {
      if (err) {
        // 如果列已存在，SQLite会返回错误，但我们可以继续执行
        if (err.message.includes('duplicate column name')) {
          console.log('exposure列已存在，跳过添加。');
          resolve();
        } else {
          reject(err);
        }
      } else {
        console.log('成功添加exposure列。');
        resolve();
      }
    });
  });
}

// 添加familiarity列
function addFamiliarityColumn() {
  return new Promise((resolve, reject) => {
    db.run('ALTER TABLE words ADD COLUMN familiarity INTEGER DEFAULT 0', (err) => {
      if (err) {
        // 如果列已存在，SQLite会返回错误，但我们可以继续执行
        if (err.message.includes('duplicate column name')) {
          console.log('familiarity列已存在，跳过添加。');
          resolve();
        } else {
          reject(err);
        }
      } else {
        console.log('成功添加familiarity列。');
        resolve();
      }
    });
  });
}

// 执行迁移
async function runMigration() {
  try {
    console.log('开始数据库迁移...');
    await addExposureColumn();
    await addFamiliarityColumn();
    console.log('数据库迁移完成！');
  } catch (err) {
    console.error('数据库迁移失败:', err.message);
  } finally {
    // 关闭数据库连接
    db.close((err) => {
      if (err) {
        console.error('关闭数据库连接失败:', err.message);
      } else {
        console.log('数据库连接已关闭。');
      }
    });
  }
}

// 运行迁移
runMigration();