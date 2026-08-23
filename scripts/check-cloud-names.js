const fs = require('fs');
const assets = JSON.parse(fs.readFileSync('c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/scripts/cloudinary_assets.json', 'utf-8'));

const cloudNames = {};
assets.forEach(a => {
  try {
    const u = new URL(a.url);
    const cloudName = u.pathname.split('/')[1];
    cloudNames[cloudName] = (cloudNames[cloudName] || 0) + 1;
  } catch {}
});

console.log('Cloud Names in database:', cloudNames);
console.log('First 5 sample URLs:');
assets.slice(0, 5).forEach(a => console.log(a.url));
