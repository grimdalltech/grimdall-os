#!/usr/bin/env node
'use strict';

const { createGrimdall } = require('grimdall-node');

const grimdall = createGrimdall();

const runShell = grimdall.wrapTool((cmd) => `[mock] executed: ${cmd}`, 'runShell');

console.log(runShell('ls -la'));

try {
  runShell('rm -rf /');
} catch (error) {
  console.log(error.message);
}

new Promise((resolve) => setTimeout(resolve, 250));
