import { Suspense, useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { LinearMipmapLinearFilter, MathUtils, SRGBColorSpace } from 'three';
import type { DayPhase, RoomWeather } from './useRoomEnvironment';

const skyImages: Record<DayPhase, string> = {
  dawn: import.meta.env.BASE_URL + 'assets/room3d/skies/sky_dawn.jpg',
  day: import.meta.env.BASE_URL + 'assets/room3d/skies/sky_day.jpg',
  sunset: import.meta.env.BASE_URL + 'assets/room3d/skies/sky_dusk.jpg',
  night: import.meta.env.BASE_URL + 'assets/room3d/skies/sky_night.jpg',
};
const fallbackColors: Record<DayPhase, string> = { dawn: '#efb5bb', day: '#c9e4e8', sunset: '#edb294', night: '#656888' };
const width = 1.95;
const height = 1.48;

function SkyImage({ phase }: { phase: DayPhase }) {
  // Cargar las cuatro juntas evita suspender de nuevo al cambiar la hora.
  const textures = useTexture(skyImages);
  const { gl, invalidate } = useThree();
  useLayoutEffect(() => {
    for (const texture of Object.values(textures)) {
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      // Equivalente a object-fit: cover; conserva las proporciones y el horizonte.
      const image = texture.image as HTMLImageElement;
      const scale = width / height / (image.width / image.height);
      texture.repeat.set(Math.min(1, scale), Math.min(1, 1 / scale));
      texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
      texture.needsUpdate = true;
    }
    invalidate();
  }, [textures, gl, invalidate]);
  return <mesh position={[0, .8, .09]}>
    <planeGeometry args={[width, height]} />
    <meshBasicMaterial map={textures[phase]} toneMapped={false} />
  </mesh>;
}

export function WindowSky({ phase, weather }: { phase: DayPhase; weather: RoomWeather | null }) {
  const label = weather?.code ?? 0;
  const snow = label >= 71 && label <= 77 || label === 85 || label === 86;
  const rain = label >= 51 && !snow;
  const cloudy = !!weather && (weather.cloudCover > 35 || label > 0);
  return <group>
    <Suspense fallback={<mesh position={[0, .8, .09]}>
      <planeGeometry args={[width, height]} /><meshBasicMaterial color={fallbackColors[phase]} />
    </mesh>}><SkyImage phase={phase} /></Suspense>
    {cloudy && <mesh position={[0, .8, .14]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial color={phase === 'night' ? '#34344f' : '#abb5c6'} transparent
        opacity={.1 + MathUtils.clamp(weather.cloudCover / 100, 0, 1) * .25} depthWrite={false} />
    </mesh>}
    {(rain || snow) && Array.from({ length: 12 }, (_, i) => <mesh key={i} position={[-.8 + (i % 4) * .5, .33 + Math.floor(i / 4) * .33, .2]} rotation={[0, 0, -.22]}>
      <boxGeometry args={snow ? [.025, .025, .01] : [.012, .12, .01]} /><meshBasicMaterial color={snow ? '#fffefb' : '#7891ae'} />
    </mesh>)}
  </group>;
}
