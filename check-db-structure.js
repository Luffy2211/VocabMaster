const sqlite3 = require('sqlite3').verbose();

// 连接数据库
const db = new sqlite3.Database('./vocab.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    return;
  }
  console.log('Connected to the SQLite database.');
  
  // 检查表结构
  checkTableStructure();
});

function checkTableStructure() {
  // 获取所有表
  db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
    if (err) {
      console.error('Error listing tables:', err.message);
      db.close();
      return;
    }
    
    console.log('Tables in database:', tables.map(table => table.name));
    
    // 检查words表的结构
    db.all("PRAGMA table_info(words)", [], (err, columns) => {
      if (err) {
        console.error('Error getting words table info:', err.message);
      } else {
        console.log('\nWords table columns:');
        columns.forEach(col => {
          console.log(`- ${col.name} (${col.type})`);
        });
      }
      
      // 检查mistakes表的结构
      db.all("PRAGMA table_info(mistakes)", [], (err, columns) => {
        if (err) {
          console.error('Error getting mistakes table info:', err.message);
        } else {
          console.log('\nMistakes table columns:');
          columns.forEach(col => {
            console.log(`- ${col.name} (${col.type})`);
          });
        }
        
        // 检查test_results表的结构
        db.all("PRAGMA table_info(test_results)", [], (err, columns) => {
          if (err) {
            console.error('Error getting test_results table info:', err.message);
          } else {
            console.log('\nTest_results table columns:');
            columns.forEach(col => {
              console.log(`- ${col.name} (${col.type})`);
            });
          }
          
          db.close();
        });
      });
    });
  });
}