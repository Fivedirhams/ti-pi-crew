const fs = require('fs');
let c = fs.readFileSync('src/ui/run-dashboard.ts', 'utf8');
c = c.replace(/\r\n/g, '\n');

// Filter out bare header lines like "Agents:" and "Progress:" that have no content after them
c = c.replace(
    'const filteredPane = paneLines.filter(l => l && !l.includes("(none)") && l.trim() !== "");',
    'const filteredPane = paneLines.filter(l => l && !l.includes("(none)") && l.trim() !== "" && l.trim() !== "Agents:" && l.trim() !== "Progress:");'
);

fs.writeFileSync('src/ui/run-dashboard.ts', c);
console.log('Filtered bare pane headers');
