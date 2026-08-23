const testUrls = [
  'https://res.cloudinary.com/dvtjjt3js/video/upload/v1768666149/loveworld-singers/audio/qdk2gclslkqojz4lmxzf.mp3',
  'https://res.cloudinary.com/dvtjjt3js/video/upload/loveworld-singers/audio/qdk2gclslkqojz4lmxzf.mp3',
  'https://res.cloudinary.com/dvtjjt3js/raw/upload/loveworld-singers/audio/qdk2gclslkqojz4lmxzf.mp3',
  'https://res.cloudinary.com/dvtjjt3js/image/upload/loveworld-singers/audio/qdk2gclslkqojz4lmxzf.mp3',
];

async function check() {
  for (const u of testUrls) {
    try {
      const res = await fetch(u);
      console.log(`${res.status} ${res.statusText} -> ${u}`);
      if (res.ok) {
        console.log('  Content-Type:', res.headers.get('content-type'));
        console.log('  Content-Length:', res.headers.get('content-length'));
      }
    } catch (e) {
      console.log(`Error: ${e.message} -> ${u}`);
    }
  }
}
check();
