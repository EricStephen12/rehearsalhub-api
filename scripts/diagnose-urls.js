const sampleUrls = [
  'https://res.cloudinary.com/dvtjjt3js/video/upload/v1768579519/loveworld-singers/audio/ngenoxxhhfweixum8ru2.mp3',
  'https://res.cloudinary.com/dvtjjt3js/video/upload/loveworld-singers/audio/ngenoxxhhfweixum8ru2.mp3',
  'https://res.cloudinary.com/dvtjjt3js/video/upload/loveworld-singers/audio/ngenoxxhhfweixum8ru2',
  'https://res.cloudinary.com/dvtjjt3js/raw/upload/v1768579519/loveworld-singers/audio/ngenoxxhhfweixum8ru2.mp3',
  'https://res.cloudinary.com/dvtjjt3js/raw/upload/loveworld-singers/audio/ngenoxxhhfweixum8ru2.mp3',
  'https://res.cloudinary.com/dvtjjt3js/image/upload/v1768579519/loveworld-singers/audio/ngenoxxhhfweixum8ru2.mp3',
  'https://res.cloudinary.com/dvtjjt3js/video/upload/v1768579519/loveworld-singers/audio/ngenoxxhhfweixum8ru2',
];

async function check() {
  for (const u of sampleUrls) {
    try {
      const res = await fetch(u, { method: 'HEAD' });
      console.log(`${res.status} ${res.statusText} -> ${u}`);
    } catch (e) {
      console.log(`Error: ${e.message} -> ${u}`);
    }
  }
}
check();
