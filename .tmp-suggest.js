const fs = require('fs');
const names = fs.readFileSync('.tmp-hugeicon-names.txt', 'utf8').split('\n');
const terms = process.argv.slice(2);
for (const t of terms) {
  const re = new RegExp(t, 'i');
  const hits = names.filter((n) => re.test(n));
  console.log(`## ${t} (${hits.length})`);
  console.log(hits.slice(0, 40).join(' '));
}
