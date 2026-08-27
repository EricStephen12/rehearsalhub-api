import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const cats = await sql`SELECT * FROM categories;`;
  console.log('Categories Count:', cats.length);
  cats.forEach(c => {
    console.log(c.id, c.raw_data?.name, c.raw_data?.color);
  });
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
