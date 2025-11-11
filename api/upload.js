import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import crypto from 'crypto';

function generateId() {
  return `template_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function countLinks(text) {
  if (!text) return 0;
  const links = new Set();
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) links.add(match[2]);
  return links.size;
}

function parseTemplates(text) {
  const templates = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let title = null;
  let content = [];
  let collecting = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    const titleMatch = trimmed.match(/^"([^"]+)"$/) || trimmed.match(/^"([^"]+)"$/);
    
    if (titleMatch) {
      if (title && content.length > 0) {
        const text = content.join('\n').trim();
        if (text) {
          templates.push({
            title,
            content: `**"${title}"**\n\n**Template:**\n\n${text}`,
            rawContent: text
          });
        }
      }
      title = titleMatch[1].trim();
      content = [];
      collecting = false;
    } else if (trimmed.toLowerCase() === 'template:') {
      collecting = true;
    } else if (collecting && title && trimmed) {
      content.push(trimmed);
    }
  }
  
  if (title && content.length > 0) {
    const text = content.join('\n').trim();
    if (text) {
      templates.push({
        title,
        content: `**"${title}"**\n\n**Template:**\n\n${text}`,
        rawContent: text
      });
    }
  }
  
  return templates;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { fileContent, fileBase64, fileName } = req.body;
    
    let text;
    if (fileBase64) {
      text = Buffer.from(fileBase64, 'base64').toString('utf-8');
    } else if (fileContent) {
      text = fileContent;
    } else {
      return res.status(400).json({ success: false, error: 'No content provided' });
    }

    const templates = parseTemplates(text);
    if (templates.length === 0) {
      return res.status(400).json({ success: false, error: 'No templates found' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pc.index(process.env.PINECONE_INDEX_NAME || 'templatesdb');

    const vectors = [];
    const results = [];

    for (let i = 0; i < templates.length; i++) {
      const t = templates[i];
      const emb = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: t.content,
        dimensions: 1024
      });

      const id = generateId();
      const links = countLinks(t.rawContent);

      vectors.push({
        id,
        values: emb.data[0].embedding,
        metadata: {
          title: t.title,
          content: t.content,
          raw_content: t.rawContent,
          chunk_id: `chunk_${String(i + 1).padStart(3, '0')}`,
          character_count: t.content.length,
          hyperlink_count: links,
          template_type: 'n8n_upload',
          source_file: fileName || 'unknown',
          format: 'markdown',
          created_at: new Date().toISOString()
        }
      });

      results.push({ 
        index: i + 1, 
        title: t.title, 
        id, 
        hyperlink_count: links 
      });
      
      if (i < templates.length - 1) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    await index.upsert(vectors);
    const stats = await index.describeIndexStats();

    return res.status(200).json({
      success: true,
      message: `Uploaded ${vectors.length} templates in markdown format`,
      uploaded: vectors.length,
      totalVectors: stats.totalRecordCount,
      format: 'markdown',
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}
