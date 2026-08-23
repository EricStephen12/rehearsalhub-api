const urls = [
  'https://res.cloudinary.com/dvtjjt3js/video/upload/v1768666149/loveworld-singers/audio/qdk2gclslkqojz4lmxzf.mp3',
  'https://res.cloudinary.com/dvtjjt3js/video/upload/v1772032280/loveworld-singers/audio/gonawwo9mqpyflrhvgw3.mp3',
  'https://res.cloudinary.com/dvtjjt3js/video/upload/v1768566589/loveworld-singers/audio/iotsv43mb4cnpafhxjl0.mp3',
  'https://res.cloudinary.com/dvtjjt3js/video/upload/v1769683656/loveworld-singers/audio/wfqoduyl8d5bno54yuk8.mp3',
  'https://res.cloudinary.com/dvtjjt3js/video/upload/v1767868303/loveworld-singers/audio/qm3jeti4m7cfm1dfqxzn.mp3',
  'https://res.cloudinary.com/dvtjjt3js/video/upload/v1774288579/loveworld-singers/audio/owvwxocgnahpw8usshu3.mp3',
];

async function run() {
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    const t0 = Date.now();
    try {
      const res = await fetch(u);
      console.log(`[${i + 1}] HTTP ${res.status} in ${(Date.now() - t0)/1000}s -> ${u.split('/').pop()} (${res.headers.get('content-length')} bytes)`);
    } catch (e) {
      console.log(`[${i + 1}] Error in ${(Date.now() - t0)/1000}s: ${e.message}`);
    }
  }
}
run();
