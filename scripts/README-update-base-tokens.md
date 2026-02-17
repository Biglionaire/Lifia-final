# Update Base Tokens from LiFi

Script ini mengambil daftar token Base chain dari LiFi API dan secara otomatis mengupdate file `chains.ts`.

## Penggunaan

### Prerequisites
1. Pastikan Anda punya LiFi API key (opsional tapi disarankan untuk rate limit lebih tinggi)
2. Tambahkan ke file `.env`:
   ```
   LIFI_API_KEY=your-lifi-api-key-here
   LIFI_INTEGRATOR=acp-agent
   ```

### Menjalankan Script

```bash
npm run update-base-tokens
```

Atau langsung:
```bash
npx tsx scripts/update-base-tokens.ts
```

## Apa yang Dilakukan Script

1. **Fetch tokens dari LiFi API** - Mengambil semua token yang didukung untuk Base chain (chainId: 8453)
2. **Sanitize symbols** - Membersihkan simbol token yang mengandung karakter khusus:
   - `+` → `PLUS` (misal: `USD+` → `USDPLUS`)
   - `-` → `_` 
   - `.` → `_`
   - Spasi → `_`
3. **Update chains.ts** - Mengganti semua token di section Base (8453) dengan data terbaru dari LiFi
4. **Save backup** - Menyimpan data mentah JSON ke folder `data/` dengan timestamp

## Output

Script akan menghasilkan:
- File JSON backup di `data/base_tokens_[timestamp].json`
- Update otomatis ke `src/seller/offerings/_shared/chains.ts`

## Contoh Output

```
⏳ Fetching Base chain tokens from LI.FI API...
✓ Using LIFI_API_KEY from environment
✅ Fetched 150 tokens for Base chain
✅ Saved raw data to data/base_tokens_2024-02-17T16-30-00-000Z.json

⏳ Updating chains.ts file...
✅ Updated src/seller/offerings/_shared/chains.ts
✅ Total tokens in Base chain: 150

🎉 Successfully updated Base chain tokens!

Next steps:
1. Review the changes in chains.ts
2. Test that imports work correctly
3. Commit the changes
```

## Troubleshooting

**Error: "Failed to fetch LI.FI tokens"**
- Periksa koneksi internet
- Pastikan LiFi API key valid (jika digunakan)
- LiFi API mungkin down atau rate limited

**Error: "Could not find Base chain (8453) section"**
- File chains.ts mungkin sudah dimodifikasi
- Pastikan struktur `8453: {` masih ada di file

## Notes

- Script ini akan **mengganti semua** token yang ada di section Base (8453)
- Token disort secara alfabetis untuk kemudahan pembacaan
- Duplicate symbols akan diskip
- Symbol dengan karakter khusus akan disanitize dan ditambahkan komentar untuk referensi
