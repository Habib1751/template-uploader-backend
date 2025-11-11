# Template Uploader Backend

Backend API for uploading templates to Pinecone with markdown conversion.

## Endpoint

POST /api/upload

## Request Body

```json
{
  "fileContent": "template text content",
  "fileName": "templates.txt"
}
