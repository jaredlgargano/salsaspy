import fs from 'fs';

const raw = fs.readFileSync('scripts/graphql-out.json', 'utf-8');
const data = JSON.parse(raw);

const feedBody = data.data?.searchWithFilterFacetFeed?.body || [];

function inspectNode(n, depth = 0) {
    if (!n) return;
    const prefix = '  '.repeat(depth);
    
    // Print what we know about this node
    let info = [];
    if (n.__typename) info.push(`Type: ${n.__typename}`);
    if (n.id) info.push(`ID: ${n.id}`);
    if (n.category) info.push(`Category: ${n.category}`);
    if (n.name) info.push(`Name: ${n.name}`);
    if (n.text?.title) info.push(`Title: ${n.text.title}`);
    if (n.events?.click?.data) info.push(`ClickData: ${JSON.stringify(n.events.click.data)}`);
    
    if (info.length > 0) {
        console.log(`${prefix}- ${info.join(', ')}`);
    }

    if (n.items) n.items.forEach(child => inspectNode(child, depth + 1));
    if (n.body) n.body.forEach(child => inspectNode(child, depth + 1));
    if (n.childrenMap) n.childrenMap.forEach(child => inspectNode(child, depth + 1));
    if (n.children) n.children.forEach(child => inspectNode(child, depth + 1));
}

console.log("Feed Body Nodes:");
feedBody.forEach(node => inspectNode(node));
