const fs = require('node:fs')
const path = require('node:path')

const source = path.join(__dirname, '..', 'src', 'preload', 'index.cjs')
const target = path.join(__dirname, '..', 'dist-electron', 'preload', 'index.cjs')

fs.mkdirSync(path.dirname(target), { recursive: true })
fs.copyFileSync(source, target)
