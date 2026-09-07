/**
 * The actual R3F scene contents: one InstancedMesh for every live cell across
 * every rendered slice, a key light + ambient + optional fog, a labelled time
 * axis, the slicing plane, and the flat-world -> three-quarter camera intro.
 *
 * Per ARCHITECTURE.md's performance rule, nothing here calls React `setState`
 * on a per-frame basis: the camera intro and OrbitControls damping mutate
 * object3D transforms directly inside `useFrame`. The instanced-matrix build
 * is chunked across animation frames and is cancellable (an effect cleanup
 * bumps a token that the in-flight loop checks before touching the mesh).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Generation } from '@/core/types';
import type { InstancePlacement } from './geometry';
import { readCssColor, prefersReducedMotion } from './tokens';

export const CELL_SIZE = 0.9;
export const SPACING_Z = 1.15;
export const BOX_SIZE = 0.72;

export interface SceneParams {
  placements: InstancePlacement[];
  sliceCount: number;
  rectW: number;
  rectH: number;
  fromGen: Generation;
  toGen: Generation;
  /** absolute generation for each rendered slot, ascending. */
  slotGens: Generation[];
  decorations: boolean;
  planeSlot: number;
  historyDepth: number;
  onPick?: (gen: Generation) => void;
  onBuildProgress?: (done: number, total: number) => void;
  reduceMotion: boolean;
  cameraApiRef?: { current: CameraApi | null };
}

export interface CameraApi {
  orbit(deltaAzimuth: number, deltaPolar: number, dolly?: number): void;
}

const CHUNK = 4000;

export function SculptureScene(params: SceneParams) {
  const {
    placements, sliceCount, rectW, rectH, slotGens,
    decorations, planeSlot, historyDepth, onPick, onBuildProgress, reduceMotion,
  } = params;

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const buildToken = useRef(0);

  const geometry = useMemo(() => new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.05, vertexColors: true }),
    [],
  );

  // Dispose our own GPU resources when the scene unmounts (sculpture close()).
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  const timePast = useMemo(() => readCssColor('--color-ink-600', '#4a5b5c'), []);
  const timePresent = useMemo(() => readCssColor('--color-accent-time', '#7fb8e0'), []);
  const timeHighlight = useMemo(() => readCssColor('--color-ivory-100', '#f2ece0'), []);

  const depth = Math.max(0, Math.min(historyDepth, sliceCount - 1));
  const oldestVisible = Math.max(0, planeSlot - depth);

  // Chunked, cancellable (re)build of the instance matrices/colours. Runs
  // whenever the placement list itself changes (a fresh `open()`), and again
  // — cheaply, same code path — when the plane/depth/decorations change.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || placements.length === 0) return;
    const myToken = ++buildToken.current;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let i = 0;

    function step() {
      if (buildToken.current !== myToken) return; // superseded — abort
      const mesh2 = meshRef.current;
      if (!mesh2) return;
      const end = Math.min(i + CHUNK, placements.length);
      for (; i < end; i++) {
        const p = placements[i];
        const visible = p.slot >= oldestVisible && p.slot <= planeSlot;
        const scale = visible ? 1 : 0;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh2.setMatrixAt(i, dummy.matrix);

        const tGlobal = sliceCount > 1 ? p.slot / (sliceCount - 1) : 1;
        color.copy(timePast).lerp(timePresent, tGlobal);
        if (p.slot < planeSlot && depth > 0) {
          const fadeBack = Math.min(1, (planeSlot - p.slot) / Math.max(1, depth));
          color.lerp(timePast, fadeBack * 0.7);
        }
        if (p.slot === planeSlot) color.lerp(timeHighlight, 0.35);
        mesh2.setColorAt(i, color);
      }
      mesh2.instanceMatrix.needsUpdate = true;
      if (mesh2.instanceColor) {
        mesh2.instanceColor.needsUpdate = true;
        // `setColorAt` allocates `instanceColor` lazily. Three.js decides at
        // shader-compile time whether to read per-instance colour, based on
        // whether `instanceColor` existed THEN — if the very first WebGL
        // frame renders before this effect's first `setColorAt` call, the
        // program compiles without the instancing-colour path and is cached,
        // so every instance silently reads a nonexistent vertex colour (0)
        // forever after — solid black, positions still correct. Forcing a
        // material version bump makes three.js re-derive that shader
        // variant against the *current* (now non-null) `instanceColor`.
        material.needsUpdate = true;
      }
      onBuildProgress?.(i, placements.length);
      if (i < placements.length) {
        requestAnimationFrame(step);
      }
    }
    step();
    return () => { buildToken.current++; };
    // `decorations` doesn't change any placement/colour math — it's a dep
    // here ONLY because toggling it changes whether `<fog>` is attached to
    // the scene, which changes the `fog` shader define for every material
    // and forces three.js to fetch a different cached WebGLProgram. That
    // program lookup is what makes `needsUpdate` matter again (see above);
    // without re-running this effect on that toggle too, the instancing
    // colour path can silently drop out a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, planeSlot, oldestVisible, sliceCount, timePast, timePresent, timeHighlight, depth, material, decorations]);

  function handleClick(e: ThreeEvent<MouseEvent>) {
    if (e.instanceId === undefined || !onPick) return;
    const p = placements[e.instanceId];
    if (!p) return;
    const gen = slotGens[p.slot];
    if (gen !== undefined) onPick(gen);
  }

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 10, 8]} intensity={1.1} />
      {decorations && <fog attach="fog" args={[timePast.getStyle(), 8, 60]} />}

      {placements.length > 0 && (
        <instancedMesh
          ref={meshRef}
          args={[geometry, material, placements.length]}
          onClick={handleClick}
        />
      )}

      <TimeAxis rectW={rectW} rectH={rectH} slotGens={slotGens} sliceCount={sliceCount} />
      <CameraRig
        rectW={rectW}
        rectH={rectH}
        sliceCount={sliceCount}
        reduceMotion={reduceMotion || prefersReducedMotion()}
        cameraApiRef={params.cameraApiRef}
      />
    </>
  );
}

/** A labelled world-y axis line with tick marks at real generation numbers — past at the back, present at z = 0. */
function TimeAxis({
  rectW, rectH, slotGens, sliceCount,
}: { rectW: number; rectH: number; slotGens: Generation[]; sliceCount: number }) {
  const axisColor = useMemo(() => readCssColor('--color-ivory-300', '#b7ab9d'), []);
  const x = -(rectW / 2) * CELL_SIZE - 1.5;
  const y = -(rectH / 2) * CELL_SIZE - 0.5;
  const tickCount = Math.min(6, sliceCount);
  const ticks = useMemo(() => {
    if (sliceCount <= 1) return [0];
    const step = (sliceCount - 1) / Math.max(1, tickCount - 1);
    return Array.from({ length: tickCount }, (_, i) => Math.round(i * step));
  }, [sliceCount, tickCount]);

  const points: [number, number, number][] = [
    [x, y, -(sliceCount - 1) * SPACING_Z],
    [x, y, 0],
  ];

  return (
    <group>
      <Line points={points} color={axisColor.getStyle()} lineWidth={1.5} />
      {ticks.map((slot) => {
        const z = (slot - (sliceCount - 1)) * SPACING_Z;
        const gen = slotGens[slot];
        return (
          <group key={slot} position={[x, y, z]}>
            <Line points={[[0, 0, 0], [-0.4, 0, 0]]} color={axisColor.getStyle()} lineWidth={1.5} />
            <Text fontSize={0.42} color={axisColor.getStyle()} anchorX="right" anchorY="middle" position={[-0.6, 0, 0]}>
              {`gen ${gen ?? '?'}`}
            </Text>
          </group>
        );
      })}
      <Text fontSize={0.5} color={axisColor.getStyle()} anchorX="center" position={[x, y - 1.1, -(sliceCount - 1) * SPACING_Z]}>
        PAST
      </Text>
      <Text fontSize={0.5} color={axisColor.getStyle()} anchorX="center" position={[x, y - 1.1, 0]}>
        PRESENT
      </Text>
    </group>
  );
}

// Minimal local line primitive (avoids pulling in drei's heavier Line
// variants). Geometry + material are memoized and disposed on change/unmount.
function Line({ points, color, lineWidth }: { points: [number, number, number][]; color: string; lineWidth: number }) {
  const object = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
    const m = new THREE.LineBasicMaterial({ color, linewidth: lineWidth });
    return new THREE.Line(g, m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points), color, lineWidth]);
  useEffect(() => () => {
    object.geometry.dispose();
    (object.material as THREE.Material).dispose();
  }, [object]);
  return <primitive object={object} />;
}

/**
 * Camera transition: opens looking straight down the world-z axis at the
 * PRESENT slice (z = 0) exactly as the flat 2D canvas framed it (x
 * left-right, y up-down, unchanged) — then eases into a three-quarter view
 * that reveals the volume behind it. Reversed on close by the caller simply
 * unmounting (the next open() replays this intro from scratch).
 */
function CameraRig({
  rectW, rectH, sliceCount, reduceMotion, cameraApiRef,
}: {
  rectW: number; rectH: number; sliceCount: number; reduceMotion: boolean;
  cameraApiRef?: { current: CameraApi | null };
}) {
  const { camera } = useThree();
  const target = useMemo(
    () => new THREE.Vector3(0, 0, -((sliceCount - 1) * SPACING_Z) / 2),
    [sliceCount],
  );
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const progress = useRef(reduceMotion ? 1 : 0);
  const span = Math.max(rectW, rectH) * CELL_SIZE;
  const flatDistance = span * 1.15 + 4;
  const finalDistance = span * 0.95 + (sliceCount - 1) * SPACING_Z * 0.6 + 6;

  const flatPos = useMemo(() => new THREE.Vector3(0, 0, flatDistance), [flatDistance]);
  const finalPos = useMemo(() => {
    const azimuth = Math.PI / 5; // ~36°, offset to the right
    const polar = Math.PI / 3.1; // ~58° from vertical — a legible three-quarter tilt
    const r = finalDistance;
    const x = target.x + r * Math.sin(polar) * Math.sin(azimuth);
    const y = target.y + r * Math.cos(polar);
    const z = target.z + r * Math.sin(polar) * Math.cos(azimuth);
    return new THREE.Vector3(x, y, z);
  }, [finalDistance, target]);

  useEffect(() => {
    camera.position.copy(reduceMotion ? finalPos : flatPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    progress.current = reduceMotion ? 1 : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    if (progress.current < 1) {
      progress.current = Math.min(1, progress.current + delta / 0.5); // ~duration-slow-ish
      const t = easeStandard(progress.current);
      camera.position.lerpVectors(flatPos, finalPos, t);
      camera.lookAt(target);
      if (controlsRef.current) controlsRef.current.target.copy(target);
    }
  });

  // Bridge a tiny imperative orbit API up to `TimeSculpture.orbit()`, since
  // the OrbitControls instance lives inside this R3F subtree.
  useEffect(() => {
    if (!cameraApiRef) return undefined;
    cameraApiRef.current = {
      orbit(deltaAzimuth, deltaPolar, dolly = 1) {
        const offset = camera.position.clone().sub(target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta += deltaAzimuth;
        spherical.phi = THREE.MathUtils.clamp(spherical.phi + deltaPolar, 0.05, Math.PI - 0.05);
        spherical.radius = Math.max(0.1, spherical.radius * dolly);
        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset);
        camera.lookAt(target);
        controlsRef.current?.update();
      },
    };
    return () => { cameraApiRef.current = null; };
  }, [cameraApiRef, camera, target]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      target={target}
      minDistance={span * 0.4}
      maxDistance={finalDistance * 2.5}
      minPolarAngle={Math.PI * 0.08}
      maxPolarAngle={Math.PI * 0.92}
    />
  );
}

function easeStandard(t: number): number {
  // matches --ease-standard cubic-bezier(0.2, 0, 0, 1) closely enough for a camera lerp
  return 1 - Math.pow(1 - t, 3);
}
