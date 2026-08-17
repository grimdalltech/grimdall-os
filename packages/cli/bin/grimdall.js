#!/usr/bin/env node
'use strict';

const { main } = require('../dist/index.js');

Promise.resolve(main(process.argv.slice(2))).catch((error) => {
  console.error(`[ERROR] ${(error && error.message) || error}`);
  process.exitCode = 1;
});
