# Cloudinary setup

Product images are uploaded directly from the browser to Cloudinary. The server only signs the upload and later confirms it. Until three variables are set the feature is off: the upload endpoints answer 503, the UI says "Media storage not configured", and nothing is faked.

The Cloudinary integration has been tested only with the SDK mocked. It has never run against a real account. Section 5 lists what to verify.

## 1. Create an account and copy credentials

1. Sign up at cloudinary.com (the free plan is enough to start).
2. In the console, open Settings > API Keys (or the dashboard "Product Environment Credentials" panel) and copy:

   | Variable | What it is | Visible to the browser |
   |---|---|---|
   | `CLOUDINARY_CLOUD_NAME` | Your cloud name | No (it appears in upload URLs the server returns) |
   | `CLOUDINARY_API_KEY` | API key | Returned to the uploader with each signature (Cloudinary requires it in the upload form) |
   | `CLOUDINARY_API_SECRET` | API secret | Never. Server only. |

3. Put them in `.env.local` for local runs or in the Vercel project settings for deployments. Do not commit them, and do not paste them into chat, issues, pull requests or logs. If a secret leaks, regenerate it in the Cloudinary console and update every place it is stored.

After setting them, restart `npm run dev` (server env is cached per process). `isConfigured("cloudinary")` is true only when all three are present.

## 2. What the app signs

Upload flow (`src/lib/cloudinary/index.ts`):

1. `POST /api/uploads/sign` checks the session, role permission, rate limit (30 per minute) and the declared content type and size, then generates the whole public id on the server: `organizations/{orgId}/{kind}/{24 hex characters}`. The client cannot choose or change it.
2. The signed parameters are `public_id`, `timestamp`, `allowed_formats` (`jpg,png,webp,avif`), `overwrite=0` (off) and `type=upload`. Because Cloudinary requires every posted parameter except `file`, `cloud_name`, `resource_type` and `api_key` to be signed, the client cannot add a folder, eager transformations or a notification URL.
3. The browser posts the file and those parameters to the returned `uploadUrl`.
4. `POST /api/uploads/confirm` fetches the asset through the Admin API and checks resource type, format, dimensions, URL host and cloud, and size. Cloudinary has no signed size limit, so the 5 MB limit is enforced here: an asset that breaks the policy is deleted and rejected. On success a record is stored in the `uploads` collection (document id is the SHA-256 of the public id), and products accept only images that have such a record.
5. `POST /api/uploads/delete` removes an owned asset and its record. Removing an image in the product form and saving deletes the asset after the product is saved.

Allowed: JPEG, PNG, WebP and AVIF, up to 5 MB (5,242,880 bytes). Knowledge-base documents (PDF, raw) are not supported yet.

## 3. Quotas

- `/api/uploads/sign`: 30 per minute per user.
- `/api/uploads/confirm`: 60 per minute per user, plus 120 per hour per user and 300 per hour per organization. Every confirm spends one Cloudinary Admin API call, and Cloudinary rate-limits the Admin API per account (a shared hourly allowance), so one member must not be able to exhaust it for every tenant. The hourly limits are in `src/lib/cloudinary/quota.ts`.
- Check your plan's Admin API allowance in the Cloudinary console and adjust `CONFIRM_QUOTA` if you have far more or far fewer tenants than the defaults assume.

## 4. Orphan uploads

An upload can end up in Cloudinary with no product pointing at it:

- the browser uploaded the file but never called confirm (tab closed, network error), or
- the user uploaded an image, then discarded the form without saving.

These files stay in Cloudinary and count against storage. There is no cleanup job yet; it is future work. Until then, review `organizations/` in the Media Library occasionally, and compare with the `uploads` collection in Firestore (confirmed uploads) if you need to find unreferenced files.

## 5. Known limits to verify on a real account

Verify each of these the first time real credentials are used, and record the outcome in [../CHECKLIST.md](../CHECKLIST.md):

1. **Signature acceptance.** Cloudinary accepts the signature for exactly the parameters the app signs (`allowed_formats`, `overwrite=0`, `public_id`, `timestamp`, `type`). If an upload fails with "Invalid Signature", compare the string-to-sign in the error message with the signed parameters.
2. **`overwrite=0`.** Confirm that posting a second file with the same signature does not replace the first asset.
3. **Folder mode.** Cloudinary accounts use either fixed-folder mode or dynamic-folder mode. The app puts the folder path inside `public_id`. In dynamic-folder mode the asset's displayed folder and its public id are separate; check that the asset appears where you expect and that `confirm` still sees the public id unchanged.
4. **Replay.** A signature is valid for about an hour and can be posted again. With `overwrite` off, a replayed image post returns the existing asset and does not create another.
5. **Raw and video replay residue.** The same signed parameters are also valid at the `raw` and `video` upload endpoints. A replay there can create one extra asset at the same public id per resource type. `confirm` accepts images only, so that asset can never be confirmed or attached to a product, but it occupies storage until removed. Expect at most one such extra asset per resource type per signature.

## 6. Smoke test

1. Set the three variables, restart the server, sign in as an owner or admin.
2. Open a product (or create one) and upload a small JPEG. The image should appear in the gallery.
3. In the Cloudinary Media Library, find it under `organizations/<your-org-id>/products/`.
4. Check Firestore: an `uploads` document exists for it.
5. Save the product. Reload; the image is still there.
6. Try a file larger than 5 MB and a non-image file. Both must be rejected, and nothing from them should remain in the Media Library.
7. Remove the image in the product form and save. The asset should disappear from the Media Library and the `uploads` record should be gone.
8. Unset a variable and restart: uploading must answer 503 with the "not configured" message.
