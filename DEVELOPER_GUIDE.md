# RehearsalHub Songs API — Developer Integration Guide

## Overview

This API gives you access to the full catalog of RehearsalHub songs including Cloudinary audio URLs, lyrics, song metadata, and multi-part audio tracks.

---

## Base URL

Once deployed, your base URL will look like:

```
https://your-api.up.railway.app
```

For local testing:

```
http://localhost:3000
```

---

## Authentication

Every request to `/api/*` endpoints **must include** the following header:

```
x-api-key: YOUR_SECRET_KEY
```

Requests without a valid key return:

```json
{
  "success": false,
  "error": "Unauthorized. Provide a valid x-api-key header."
}
```

> **Keep your API key private.** Do not commit it to git or expose it in client-side code. Store it in your environment variables.

---

## Rate Limiting

- **200 requests per 15 minutes** per IP address
- When exceeded, you receive a `429 Too Many Requests` response

---

## Endpoints

### 1. Health Check

```
GET /health
```

No authentication required. Use this to verify the API is up.

**Response:**
```json
{
  "status": "ok",
  "service": "rehearsalhub-api",
  "timestamp": "2026-07-22T12:00:00.000Z"
}
```

---

### 2. Get All Master Songs

```
GET /api/master-songs
```

Returns the full catalog of master songs (796 songs).

**Headers:**
```
x-api-key: YOUR_SECRET_KEY
```

**Response:**
```json
{
  "success": true,
  "count": 796,
  "data": [
    {
      "id": "l80bV6jmDVkCfqEaRQLO",
      "title": "THE MASTERPIECE OF YOUR LOVE DESIGN",
      "key": "E-FLAT",
      "tempo": "120 BPM",
      "category": "PRAISE",
      "writer": "EVANG",
      "conductor": "",
      "leadSinger": "FAITH EJURA",
      "drummer": "TOSIN",
      "bassGuitarist": "VICTOR",
      "leadKeyboardist": "PRAISE",
      "audioFile": "https://res.cloudinary.com/dvtjjt3js/video/upload/v1771697385/loveworld-singers/audio/qfnhzsaigvptikkil7cn.mp3",
      "audioUrls": {
        "full": "https://res.cloudinary.com/.../full.mp3",
        "BAND": "https://res.cloudinary.com/.../band.mp3",
        "BACKUP VOCALS": "https://res.cloudinary.com/.../backup.mp3",
        "BAND & LEAD VOCALS": "https://res.cloudinary.com/.../band-lead.mp3",
        "BAND & BACKUP VOCALS": "https://res.cloudinary.com/.../band-backup.mp3"
      },
      "imageUrl": null,
      "lyrics": "<div><b>VERSE 1</b><br>...</div>",
      "solfa": "",
      "categories": [],
      "customParts": ["BAND", "BAND & LEAD VOCALS", "BACKUP VOCALS", "BAND & BACKUP VOCALS"],
      "sourceType": "manual",
      "publishedAt": null,
      "updatedAt": null
    }
  ]
}
```

**Field Reference:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique song ID |
| `title` | string | Song title |
| `key` | string | Musical key (e.g. "E-FLAT", "G") |
| `tempo` | string | Tempo (e.g. "120 BPM") |
| `category` | string | Song category (e.g. "PRAISE", "WORSHIP", "HEALING") |
| `writer` | string | Song writer |
| `conductor` | string | Conductor name |
| `leadSinger` | string | Lead singer name |
| `drummer` | string | Drummer name |
| `bassGuitarist` | string | Bass guitarist name |
| `leadKeyboardist` | string | Lead keyboardist name |
| `audioFile` | string | Main Cloudinary MP3 URL (full song) |
| `audioUrls` | object | Multiple audio parts — see below |
| `imageUrl` | string\|null | Song artwork URL |
| `lyrics` | string | HTML-formatted lyrics |
| `solfa` | string | Solfa notation |
| `categories` | array | Additional category tags |
| `customParts` | array | Available audio part names |
| `sourceType` | string | Source type ("manual") |
| `publishedAt` | string\|null | Published timestamp |
| `updatedAt` | string\|null | Last updated timestamp |

**About `audioUrls`:**

`audioUrls` is a JSON object where each key is a track part name and the value is the Cloudinary URL. Common keys:
- `full` — the complete song mix (same as `audioFile`)
- `BAND` — band only, no vocals
- `BACKUP VOCALS` — backup vocals only
- `BAND & LEAD VOCALS` — band + lead singer
- `BAND & BACKUP VOCALS` — band + backup vocals

Not all songs have multiple parts. Always check if `audioUrls` is null or if a specific key exists before using it.

---

### 3. Get Single Master Song

```
GET /api/master-songs/:id
```

Returns a single song by its ID.

**Example:**
```
GET /api/master-songs/l80bV6jmDVkCfqEaRQLO
```

**Response:**
```json
{
  "success": true,
  "data": { ...full song object... }
}
```

**404 Response:**
```json
{
  "success": false,
  "error": "Song not found"
}
```

---

### 4. Get All Praise Night Songs

```
GET /api/praise-night-songs
```

Returns all praise night songs (2,415 songs across all zones and praise nights).

**Optional query parameters:**

| Param | Description | Example |
|-------|-------------|---------|
| `praiseNightId` | Filter by a specific praise night | `?praiseNightId=7tLxxIAcCw1uSohBVYBd` |
| `zoneId` | Filter by zone | `?zoneId=zone-orchestra` |

**Example filtered request:**
```
GET /api/praise-night-songs?praiseNightId=7tLxxIAcCw1uSohBVYBd
```

**Response:**
```json
{
  "success": true,
  "count": 45,
  "data": [
    {
      "id": "fWURaNczgqsvAfT6507d",
      "title": "YOU SAID, \"LET THERE BE\"",
      "key": "F-SHARP",
      "tempo": "",
      "category": "DAY 1",
      "writer": "MAYA",
      "conductor": "PASTOR SAKI",
      "leadSinger": "MAYA",
      "drummer": "TOLU",
      "audioFile": "https://res.cloudinary.com/dvtjjt3js/video/upload/v1767779224/loveworld-singers/audio/cuhrtkszdinbrarycatd.mp3",
      "audioUrls": null,
      "lyrics": "<div><b>VERSE 1</b>...</div>",
      "categories": ["DAY 1"],
      "status": "heard",
      "isActive": false,
      "zoneId": "zone-orchestra",
      "praiseNightId": "7tLxxIAcCw1uSohBVYBd",
      "createdAt": "2026-07-20T16:39:50.769Z",
      "updatedAt": null
    }
  ]
}
```

---

### 5. Get Single Praise Night Song

```
GET /api/praise-night-songs/:id
```

Returns a single praise night song by its ID.

---

## Code Examples

### JavaScript / React Native (fetch)

```javascript
const API_BASE = 'https://your-api.up.railway.app';
const API_KEY = process.env.REHEARSALHUB_API_KEY; // store in .env

// Get all master songs
async function getMasterSongs() {
  const response = await fetch(`${API_BASE}/api/master-songs`, {
    headers: {
      'x-api-key': API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const { data, count } = await response.json();
  console.log(`Loaded ${count} songs`);
  return data;
}

// Get a single song
async function getSongById(id) {
  const response = await fetch(`${API_BASE}/api/master-songs/${id}`, {
    headers: { 'x-api-key': API_KEY },
  });
  const { data } = await response.json();
  return data;
}

// Get praise night songs for a specific night
async function getPraiseNightSongs(praiseNightId) {
  const response = await fetch(
    `${API_BASE}/api/praise-night-songs?praiseNightId=${praiseNightId}`,
    { headers: { 'x-api-key': API_KEY } }
  );
  const { data } = await response.json();
  return data;
}
```

### Axios

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://your-api.up.railway.app',
  headers: {
    'x-api-key': process.env.REHEARSALHUB_API_KEY,
  },
});

// Get all songs
const { data } = await api.get('/api/master-songs');
console.log(data.count, data.data);

// Get single song
const { data: song } = await api.get('/api/master-songs/SONG_ID');
console.log(song.data.audioFile);
```

### Play audio in React Native

```javascript
import { Audio } from 'expo-av';

async function playSong(song) {
  // Use 'full' URL if available, fall back to audioFile
  const audioUrl = song.audioUrls?.full ?? song.audioFile;

  if (!audioUrl) {
    console.warn('No audio available for this song');
    return;
  }

  const { sound } = await Audio.Sound.createAsync({ uri: audioUrl });
  await sound.playAsync();
}
```

---

## Error Responses

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `401` | Missing or invalid `x-api-key` header |
| `404` | Song not found |
| `429` | Rate limit exceeded (200 req / 15 min) |
| `500` | Server error |

All errors follow this format:
```json
{
  "success": false,
  "error": "Description of the error"
}
```

---

## Best Practices

1. **Cache the song list** — Don't call `/api/master-songs` on every screen render. Fetch once on app launch and store it in state/context/storage.
2. **Store the API key in `.env`** — Never hardcode it in your source files.
3. **Check `audioUrls` before using parts** — Not every song has multiple parts. Always check `song.audioUrls?.BAND` before using it.
4. **Handle null audio gracefully** — Some songs may have `audioFile: null`. Show a "No audio available" state in your UI.
5. **Use the `/health` endpoint** to check if the API is reachable before making data requests.

---

## Contact

For API key issues or questions, contact the RehearsalHub team.
