#!/usr/bin/env node
// Astrion OS — Ember Modelfile generator
//
// Renders custom-model/ember/Modelfile{,.tiny,.standard,.big} from
// js/kernel/ember-identity.js. The prompt text is never typed twice.
//
// Why a generator instead of just writing the Modelfile by hand:
// Ember's identity has to reach two places that share no code. The
// local Ollama model gets it from a Modelfile SYSTEM block; a cloud
// model has no Modelfile at all and has to be handed the same text on
// the wire by ai-service.js. Two hand-maintained copies drift, and the
// day they drift is the day the local assistant and the cloud assistant
// describe themselves differently to the same user. That reads as
// dishonest, not unfinished. So: one source, one generator.
//
//   node custom-model/ember/build-modelfile.js           write the files
//   node custom-model/ember/build-modelfile.js --check   verify, write nothing
//
// --check exits 1 if any file on disk differs from what the module
// renders right now. That is the drift alarm -- run it in CI, or before
// a demo, and hand-edits to a generated file get caught by a machine
// instead of by a user asking the assistant who it is.
//
// This script does not talk to Ollama and does not download anything.
// It writes text files. Building the actual model (`ollama create`)
// happens on the machine that runs the model.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EMBER_TIERS,
  EMBER_DEFAULT_TIER,
  EMBER_IDENTITY_VERSION,
  renderEmberModelfile,
  emberIdentityFingerprint,
} from '../../js/kernel/ember-identity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes('--check');

// tier id -> filename. The unsuffixed `Modelfile` is a second copy of
// the default tier, so `ollama create ember -f Modelfile` does the
// obvious thing for someone who did not read any of this.
function targets() {
  const out = EMBER_TIERS.map(t => [join(HERE, `Modelfile.${t.id}`), renderEmberModelfile(t.id)]);
  out.push([join(HERE, 'Modelfile'), renderEmberModelfile(EMBER_DEFAULT_TIER)]);
  return out;
}

if (!existsSync(HERE)) mkdirSync(HERE, { recursive: true });

let drift = 0;
for (const [path, text] of targets()) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (check) {
    // Missing counts as drift. A --check that passes because the file
    // is absent is worse than no check at all -- it would go green on
    // exactly the state where nothing is generated.
    const onDisk = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (onDisk === null) {
      console.error(`DRIFT ${name}: missing, run without --check to generate`);
      drift++;
    } else if (onDisk !== text) {
      console.error(`DRIFT ${name}: on-disk copy does not match js/kernel/ember-identity.js`);
      drift++;
    } else {
      console.log(`ok    ${name}`);
    }
  } else {
    writeFileSync(path, text, 'utf8');
    console.log(`wrote ${name}`);
  }
}

const fp = `ember identity v${EMBER_IDENTITY_VERSION} fingerprint ${emberIdentityFingerprint()}`;
if (check && drift > 0) {
  console.error(`\n${drift} file(s) drifted. ${fp}`);
  console.error('Fix: node custom-model/ember/build-modelfile.js');
  process.exit(1);
}
console.log(`\n${fp}`);
