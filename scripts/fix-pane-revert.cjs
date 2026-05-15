const fs = require('fs');
let c = fs.readFileSync('src/ui/run-dashboard.ts', 'utf8');
c = c.replace(/\r\n/g, '\n');

// Relax the filter: keep bare "Agents:" and "Progress:" lines since they have
// content after them. Only filter (none) lines.
c = c.replace(
    'const filteredPane = paneLines.filter(l => l && !l.includes("(none)") && l.trim() !== "" && l.trim() !== "Agents:" && l.trim() !== "Progress:");',
    'const filteredPane = paneLines.filter(l => l && !l.includes("(none)") && l.trim() !== "");'
);

fs.writeFileSync('src/ui/run-dashboard.ts', c);
console.log('Reverted bare header filter');
