# Community photos ("Add your photo")

Anyone can send campus photos from **https://www.mehr-anand.com/nuguessr/contribute**. This page covers how a submission becomes a round, and the extra curation rules for these photos.

## How it works

```
phone/browser                         Supabase                               your machine (service key)
-------------                         --------                               --------------------------
pick photos
read GPS in the browser (exifr) ─┐
confirm or drop the pin          │
credit + consent                 │
upload ORIGINAL ─────────────────┼──▶ private bucket `submissions/<uid>/<uuid>.<ext>`
submit_photo() ──────────────────┘    photo_submissions (status 'pending')
                                                │
                                                └──────────────────────▶ places:fetch:submissions
                                                                         (download originals to data/submissions/,
                                                                          add `community` candidates)
                                                                         places:names → curate → select → publish
                                                                         (processImage: rotate, crop/blur, WebP,
                                                                          ALL metadata stripped, <uuid>.webp)
                                     public bucket `images` + places row ◀─┘
                                     photo_submissions approved/rejected ◀── places:submissions:sync
                                     original deleted from `submissions`  ◀─┘ (also sweeps orphaned uploads)
```

Why the pin and not the photo's GPS: iOS strips GPS from photos taken with the camera from a web page, keeps it for Photo Library picks only when **Options → Location** is on, and indoor GPS is often 10–50 m off. The contributor was standing there, so their pin is the answer; the EXIF location is stored only to flag big disagreements during review.

## Running it

```bash
npm run places:fetch:submissions          # pending submissions -> data/candidates.json (source 'community')
npm run places:names                       # nearest OSM names (outdoor photos)
# curate: write data/curation/batch-N.json decisions (rules below), review-N.json for overrides
npx tsx scripts/places/select.ts --target 200   # raise the target as the pool grows
npm run places:publish
npm run places:submissions:sync            # approve/reject in the DB, delete originals, sweep orphans
npm run places:export
```

Add `--dry-run` to the fetch and sync scripts to see what they'd do.

## Curation rules for `community` photos

Look at every photo at full resolution (a sign unreadable at 960 px can be readable at 1920 px).

- **Indoor is allowed** (unlike sourced photos). Set `is_outdoor_campus_scene` to whatever is true; `select.ts` doesn't require it for `community`.
- **Reject:** blurry or dark, nothing distinctive, screenshots, photos of screens, memes, anything inappropriate, clearly not on campus, or a near-duplicate of a better shot of the same spot.
- **People:** reject if anyone is identifiable and prominent. If people are small or incidental, blur their faces with `redact` regions.
- **Giveaways:** room numbers, door plaques, building names on walls, whiteboard or projector text naming a course or room, posters naming a club room, Wi-Fi network names. Blur them with `redact` if the photo still works (the license becomes `contributed (text blurred)`), otherwise reject.
- **Pin check:** the candidate's `submission` block has `indoor`, `building`, `spot_description`, `location_source` and `exif_pin_distance_m`.
  - Indoor and the pin is outside the named building's OSM footprint: put the corrected point (nearest point inside the footprint, or its centroid) in the decision's `lat`/`lng`, set `pin_check: "ok"` (`select.ts` only takes `ok`, and it publishes the decision's coordinates) and mention the correction in `reason`.
  - `exif_pin_distance_m > 75`: trust the pin, but say so in `reason`.
- **Name:** a clear display name, e.g. `Richards Hall, 3rd-floor classroom`. Never copy a room number into the name if it isn't visible in the photo; "classroom" is enough.
- **Reject reason:** keep `reason` short and polite. It's stored in `photo_submissions.review_notes`, which only admins can read.

## Privacy

- Originals (full EXIF: GPS, device, time) live only in the private `submissions` bucket until a decision is made, then `places:submissions:sync` deletes them. Rejected and withdrawn local copies in `data/submissions/` are deleted too; approved ones are kept locally (git-ignored) so a crop can be redone. `--purge-local` deletes those as well.
- `photo_submissions.contact` is optional, admin-only and only for takedown requests. Players can never read the table; `my_submissions()` returns status only.
- Credit is the name the contributor typed (≤ 40 chars) or "NUguessr community". It's rendered as plain text everywhere.

## Takedown requests

1. Find the submission (`select * from photo_submissions where ...` as admin, or match the credit name).
2. `update places set active = false where id = <place_id>;` (stops it appearing in new games immediately).
3. Delete the image from the `images` bucket and the row from `places` if they want it gone entirely.
4. `update photo_submissions set status = 'withdrawn' where id = ...;` then `places:submissions:sync`.
