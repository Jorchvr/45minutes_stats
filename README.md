# 45 MINUTES · STATS

Dashboard estático para monitorear la operación del gym desde cualquier lugar.

## Arquitectura

```
PC1 (GymMamba)                           GitHub                    Cliente (browser)
──────────────                       ──────────────           ──────────────────────
SnapshotService  ──── cifra AES-GCM ──▶  branch `data`   ◀── raw.githubusercontent
(timer 30s)          + git push --force   snapshot.json         GH Pages: index.html
                                                                descifra en el cliente
```

## Cómo funciona

1. **Runner (dentro de GymMamba, PC1):** cada 30 s consulta SQLite → arma JSON con
   stats (caja, ventas, accesos, socios, stock) → cifra con AES-GCM 256 usando llave
   derivada del password del dueño → `git push --force` al branch `data`.
2. **Página estática (GH Pages):** el dueño abre la URL, mete el password → la llave
   se deriva en el browser con PBKDF2 → `fetch` a `raw.githubusercontent.com` cada
   30 s → descifra en el cliente → pinta las cards.

## Repos y ramas

- `main` — HTML + CSS + JS del dashboard (servido por GitHub Pages).
- `data` — un solo archivo `snapshot.json`, force-push cada 30 s (sin historial).

## Seguridad

- El snapshot está **cifrado en reposo** en GitHub. La llave nunca sale de PC1 ni del
  browser del dueño; nunca viaja al servidor.
- El password solo se guarda en `sessionStorage` (se borra al cerrar la pestaña).
- Si alguien encuentra la URL sin password, ve puro base64 inútil.

## Configuración

Ver `../GymMamba/appsettings.json` sección `"StatsRunner"`:

```json
"StatsRunner": {
  "Enabled": true,
  "IntervalSeconds": 30,
  "Password": "REEMPLAZAR",
  "RepoPath": "C:\\Users\\Jorge\\Documents\\code\\45minutes_stats",
  "RepoUrl": "https://github.com/Jorchvr/45minutes_stats.git",
  "GitUserName": "45minutes-runner",
  "GitUserEmail": "runner@45minutes.local"
}
```

## Rotar el password

1. Cambiar `Password` en `appsettings.json` (PC1).
2. Reiniciar GymMamba.
3. Todos los dashboards abiertos tendrán que meter el nuevo password.
