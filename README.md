# Cloud Frontend

Angular frontend for MVP file storage with MinIO integration.

## Run locally

1. Install dependencies:
   - `npm install`
2. Start development server:
   - `npm start`
3. Open [http://localhost:4200](http://localhost:4200)

## API contract used by frontend

- `POST /v1/storage/presign` with `{ "content_type": "..." }` -> presigned `upload_url`
- `PUT upload_url` -> raw file bytes with exact `Content-Type` from presign response
- `GET /v1/storage/blobs` -> `{ "items": [...] }`
- `POST /v1/storage/blobs/{blob_id}/presign-get` -> presigned `download_url`
- `DELETE /v1/storage/blobs/{blob_id}` -> `204`

Base API URL is configured in `src/environments/environment.ts` via `apiBaseUrl` (`http://localhost:8080/v1` by default).

## Build

Run `npm run build` to create a production build.
