# Suki's Room

Reproductor local de escritorio inspirado en Usagi, con biblioteca MP3/FLAC,
playlists, letras, dedicatorias y un cuarto 3D con Mikako y ropa persistida.
Stack: Electron, Vite, React 19, TypeScript, Motion y music-metadata;
Three.js, React Three Fiber y Drei para el cuarto.

## Comandos (PowerShell, desde la raíz)

- Instalar: `npm install` (por confirmar: el manifiesto no fija gestor ni script install).
- Desarrollo: `npm run dev`. Reiniciar tras cambiar `electron/`.
- Abrir con compilación: `npm start`.
- Tipos: `npm run typecheck`.
- Build: `npm run build` (tipos, Vite y compilación de Electron).
- Tests de dedicatorias: `npm run test:notes`.
- Tests de portadas: `npm run test:artwork`.
- Integración de portadas: `npm run test:artwork:electron` (después de build).
- Tests del regalo: `npm run test:gift`. No hay script `test` global.
- Lint: por confirmar; no hay script `lint` en `package.json`.
- Preparar datos del regalo: `npm run gift:prepare`.
- Empaquetar sin instalador: `npm run pack`.
- Portable Windows: `npm run gift:dist`.

`pack` y `gift:dist` preparan los datos del regalo y compilan antes de empaquetar.
La salida está en `release/`; el portable usa `Sukis-Room-Regalo-0.1.0.exe`.

## Carpetas clave

- `electron/`: proceso principal, IPC, biblioteca y audio local.
- `shared/`: contratos tipados entre Electron y React.
- `src/components/`: componentes compartidos, incluidas carátulas y letras.
- `src/features/library/`: biblioteca y playlists.
- `src/features/player/`: reproducción, controles y dedicatorias.
- `src/features/room/`: cuarto 3D, clima, ropa y configuración.
- `src/themes/`, `src/animations/`, `src/secrets/`: tokens, presets y eventos.
- `public/`: assets locales; `public/assets/room3d/`: imágenes del cuarto.
- `scripts/`: desarrollo, compilación, pruebas y exportación del regalo.
- `gift-seed/`: recursos del regalo incluidos por electron-builder.
- `dist/`, `dist-electron/`, `release/`: salidas de compilación y empaquetado.

## Convenciones y límites

- Mantener español en documentación e interfaz y módulos ESM en el proyecto.
- Conservar la separación Electron/preload/renderer y los contratos de `shared/`.
- El renderer no accede a Node; el preload expone métodos concretos y tipados.
- Para cambios visuales, seguir [.agents/skills/diseno-soft/SKILL.md](.agents/skills/diseno-soft/SKILL.md).
- Reutilizar `src/themes/tokens.css` y `src/animations/presets.ts`.
- Mantener Nunito, Zen Maru Gothic y los temas Miel, Sakura y Matcha.
- No modificar los archivos originales de la biblioteca de música.
- No sobrescribir canciones de `especial_songs/` ni referencias de `usagi_images/`.
- No editar a mano `node_modules/`, `dist/`, `dist-electron/` ni `release/`.
- No incluir cookies, credenciales ni el perfil completo de Chromium en el regalo.
