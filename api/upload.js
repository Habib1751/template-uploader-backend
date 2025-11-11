import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import crypto from 'crypto';

function generateUniqueId() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `template_${timestamp}_${random}`;
}

function countHyperlinks(text) {
  if (!text) return 0;
  const links = new Set();
  const markdownPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownPattern.exec(text)) !== null) {
    links.add(match[2]);
  }
  const urlPattern = /https?:\/\/[^\s)]+/g;
  const urls = text.match(urlPattern) || [];
  urls.forEach(url => links.add(url));
  return links.size;
}

function parseTemplates(text) {
  const templates = [];
  const cleanedText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleanedText.split('\n');
  
  let currentTitle = null;
  let currentContent = [];
  let collectingContent = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line && !currentTitle) continue;
    
    const titleMatch = line.match(/^(?:\d+\.\s*)?[""]([^"""]+)[""]$/) || 
                       line.match(/^(?:\d+\.\s*)?"([^"]+)"$/);
    
    if (titleMatch) {
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { fileContent, fileName, fileBase64 } = req.body;

    let textContent;
    if (fileBase64) {
      textContent = Buffer.from(fileBase64, 'base64').toString('utf-8');
    } else if (fileContent) {
      textContent = fileContent;
    } else {
      return res.status(400).json({ success: false, error: 'No content provided' });
    }

    const parsedTemplates = parseTemplates(textContent);
    if (parsedTemplates.length === 0) {
      return res.status(400).json({ success: false, error: 'No templates found' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pc.index(process.env.PINECONE_INDEX_NAME || 'templatesdb');

    const vectors = [];
    const results = [];

    for (let i = 0; i < parsedTemplates.length; i++) {
      const template = parsedTemplates[i];
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: template.content,
        dimensions: 1024,
      });

      const uniqueId = generateUniqueId();
      const hyperlinkCount = countHyperlinks(template.rawContent);

      vectors.push({
        id: uniqueId,
        values: embeddingResponse.data[0].embedding,
        metadata: {
          title: template.title,
          content: template.content,
          raw_content: template.rawContent,
          chunk_id: `chunk_${String(i + 1).padStart(3, '0')}`,
          character_count: template.content.length,
          hyperlink_count: hyperlinkCount,
          template_type: 'n8n_upload',
          source_file: fileName || 'unknown',
          format: 'markdown',
          created_at: new Date().toISOString()
        }
      });

      results.push({
        index: i + 1,
        title: template.title,
        id: uniqueId,
        hyperlink_count: hyperlinkCount
      });

      if (i < parsedTemplates.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }

    if (vectors.length > 0) {
      await index.upsert(vectors);
      const stats = await index.describeIndexStats();

      return res.status(200).json({
        success: true,
        message: `Uploaded ${vectors.length} templates`,
        uploaded: vectors.length,
        totalVectors: stats.totalRecordCount,
        format: 'markdown',
        results: results
      });
    }

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
