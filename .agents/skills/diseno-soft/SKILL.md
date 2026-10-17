---
name: diseno-soft
description: "Usar al crear o modificar componentes visuales, animaciones o estilos de Suki's Room: biblioteca, playlists, letras, dedicatorias y cuarto 3D con Mikako. Mantener la estética japonesa cute y soft inspirada en Usagi."
---

# Diseño soft de Usagi Room

Consulta [AGENTS.md](../../../AGENTS.md) para el stack, comandos, estructura y límites del proyecto.

- Parte del diseño existente: consulta `src/themes/tokens.css`, `src/styles.css`, `src/animations/presets.ts` y el componente cercano. Mantén el alcance solicitado.
- Usa los tokens `--bg`, `--surface`, `--tint`, `--accent`, `--ink` y `--muted`; comprueba los temas Miel, Sakura y Matcha. Combina fondos crema y pasteles cohesivos con texto legible; evita neón, gradientes arbitrarios y tarjetas genéricas repetidas.
- Conserva Nunito para la interfaz y Zen Maru Gothic para detalles japoneses. Diferencia títulos, acciones y texto secundario mediante peso, tamaño y espaciado; no sustituyas estas fuentes por una tipografía genérica.
- Reutiliza radios de 8–12 px en controles y 17–24 px en tarjetas, bordes finos y sombras cálidas discretas. Deja aire entre grupos; mantén adornos y pies dentro del flujo con margen y padding, también al reducir la ventana.
- Da prioridad a canción, carátula y reproducción. Usa corazones, flores y guiños japoneses como acentos puntuales, sin competir con el contenido.
- Cuida cada estado: hover con `--tint` o desplazamiento leve; foco visible de 2 px con `--accent-deep`; activo y seleccionado reconocibles sin depender solo del color. Mantén controles accesibles por teclado.
- Reutiliza `appear` y `softSpring`: transiciones breves, desplazamientos pequeños y animación de opacidad o transform. Anima para indicar entrada, respuesta o cambio de estado; respeta `prefers-reduced-motion` y evita movimiento decorativo continuo.
- Reserva detalles discretos en la mascota o interacciones secundarias para easter eggs. Añádelos solo dentro del alcance solicitado, sin ocultar acciones esenciales ni interferir con la escucha.
