import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

// @astrojs/vercel v7 어댑터는 빌드 노드가 18/20 이 아니면(예: 22) 함수 런타임을
// nodejs18.x 로 폴백한다. Vercel 이 Node 18 을 폐기해 배포가 거부되므로,
// 빌드 노드 버전과 무관하게 산출된 함수 config 의 runtime 을 nodejs20.x 로 강제한다.
const TARGET = 'nodejs20.x';
const fnDir = new URL('../.vercel/output/functions/', import.meta.url);

if (!existsSync(fnDir)) {
  console.log('no .vercel/output/functions — skip runtime fix');
  process.exit(0);
}

let fixed = 0;
for (const entry of readdirSync(fnDir)) {
  if (!entry.endsWith('.func')) continue;
  const cfgUrl = new URL(`${entry}/.vc-config.json`, fnDir);
  if (!existsSync(cfgUrl)) continue;
  const cfg = JSON.parse(readFileSync(cfgUrl, 'utf8'));
  if (typeof cfg.runtime === 'string' && cfg.runtime.startsWith('nodejs') && cfg.runtime !== TARGET) {
    console.log(`  ${entry}: ${cfg.runtime} → ${TARGET}`);
    cfg.runtime = TARGET;
    writeFileSync(cfgUrl, JSON.stringify(cfg, null, '\t'));
    fixed++;
  }
}
console.log(`✓ vercel runtime fix: ${fixed} function(s) set to ${TARGET}`);
