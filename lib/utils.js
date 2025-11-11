// lib/utils.js

import crypto from 'crypto';

export function generateUniqueId() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `template_${timestamp}_${random}`;
}

export function countHyperlinks(text) {
  if (!text) return 0;
  const links = new Set();
  
  // Markdown links
  const markdownPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownPattern.exec(text)) !== null) {
    links.add(match[2]);
  }
  
  // Plain URLs
  const urlPattern = /https?:\/\/[^\s)]+/g;
  const urls = text.match(urlPattern) || [];
  urls.forEach(url => links.add(url));
  
  return links.size;
}

export function extractHyperlinks(text) {
  const links = [];
  const markdownPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownPattern.exec(text)) !== null) {
    links.push({ text: match[1], url: match[2] });
  }
  return links;
}

export function parseTemplates(text) {
  const templates = [];
  const cleanedText = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  
  const lines = cleanedText.split('\n');
  let currentTitle = null;
  let currentContent = [];
  let collectingContent = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line && !currentTitle) continue;
    
    // Match title in quotes
    const titleMatch = line.match(/^(?:\d+\.\s*)?[""]([^"""]+)[""]$/) || 
                       line.match(/^(?:\d+\.\s*)?"([^"]+)"$/);
    
    if (titleMatch) {
      // Save previous template
      if (currentTitle && currentContent.length > 0) {
        const content = currentContent.join('\n').trim();
        if (content) {
          const markdownContent = `**"${currentTitle}"**\n\n**Template:**\n\n${content}`;
          templates.push({
            title: currentTitle,
            content: markdownContent,
            rawContent: content
          });
        }
      }
      
      currentTitle = titleMatch[1].trim();
      currentContent = [];
      collectingContent = false;
      continue;
    }
    
    if (line.toLowerCase() === 'template:') {
      collectingContent = true;
      continue;
    }
    
    if (collectingContent && currentTitle && line) {
      currentContent.push(line);
    }
  }
  
  // Save last template
  if (currentTitle && currentContent.length > 0) {
    const content = currentContent.join('\n').trim();
    if (content) {
      const markdownContent = `**"${currentTitle}"**\n\n**Template:**\n\n${content}`;
      templates.push({
        title: currentTitle,
        content: markdownContent,
        rawContent: content
      });
    }
  }
  
  return templates;
}
