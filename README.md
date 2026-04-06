# Cloud Frontend

Angular frontend for MVP file storage with MinIO integration.

## Run locally

1. Install dependencies:
   - `npm install`
2. Start development server:
   - `npm start`
3. Open [http://localhost:4200](http://localhost:4200)

## API contract used by frontend

- `POST /v1/storage/presign` with `file_name`, required `content_type`, `encrypted_file_key`, `file_iv` → presigned `upload_url` and echoed `content_type`
- `PUT upload_url` → ciphertext body; header `Content-Type` must match presign response
- `GET /v1/storage/blobs` -> `{ "items": [...] }`
- `POST /v1/storage/blobs/{blob_id}/presign-get` -> presigned `download_url`
- `DELETE /v1/storage/blobs/{blob_id}` -> `204`

Base API URL is configured in `src/environments/environment.ts` via `apiBaseUrl` (`http://localhost:8080/v1` by default).

## Build

Run `npm run build` to create a production build.
