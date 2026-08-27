import 'dotenv/config';
import { rawPgClient } from './src/db';

async function main() {
  console.log('=== SAMPLE ROW FROM media_assets ===');
  const sample = await rawPgClient`SELECT id, raw_data FROM media_assets LIMIT 1;`;
  console.log('Keys in raw_data:', Object.keys(sample[0]?.raw_data || {}));

  console.log('\n=== GROUP BY TITLE / NAME IN media_assets ===');
  const result = await rawPgClient`
    SELECT 
      COALESCE(raw_data->>'title', raw_data->>'name', 'Untitled') AS title,
      COUNT(*) AS row_count,
      array_agg(id) AS ids,
      array_agg(COALESCE(raw_data->>'url', raw_data->>'videoUrl', raw_data->>'video_url', '')) AS urls
    FROM media_assets
    WHERE COALESCE(raw_data->>'title', raw_data->>'name') IS NOT NULL
    GROUP BY COALESCE(raw_data->>'title', raw_data->>'name', 'Untitled')
    HAVING COUNT(*) > 1
    ORDER BY row_count DESC
    LIMIT 20;
  `;

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
