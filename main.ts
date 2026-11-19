// Solmar Heat — hand-in program for the gta6-01 bounty (Node 22, standard library only).
//
// The game itself is the static site in game/: plain files a desktop browser opens
// offline, no build step. This program's whole job is to deliver it: copy game/ and
// screenshots/ into the output directory and write dossier.json there with the
// vendored make.fun library, so the scorer sees exactly the bytes the library
// produces from those folders.
//
// Run it locally the same way the grader does, with MAKEFUN_OUTPUT_DIR standing
// in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Deliver the playable game first, then the screenshots the judge reads.
mkdirSync(outputDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoDir, 'screenshots'))) {
  cpSync(join(repoDir, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The caps below are the scorer's own limits for this bounty: the dossier text
// budget, at most 4 screenshots of 256 KiB each, and game/ held to 993 entries,
// 48 MiB in total and 1,000 bytes a path.
const dossierBytes = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);
