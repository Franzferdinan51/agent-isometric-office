# Duck Labs - Voxel Office Spec
## Art Style: AoE + Sims + Minecraft Hybrid

### Core Aesthetic
- **Everything is voxel/blocky** — no smooth geometry, all cubes and boxes
- **Isometric camera** — fixed 45° angle, no orbit (AoE style)
- **Warm earthy palette** mixed with cozy residential tones
- **Grid-based placement** — objects snap to a virtual grid
- **Character**: Voxel agent figures walking around

### Color Palette
- Ground: 0x3a5a2a (grass), 0x4a3a2a (dirt path)
- Building walls: 0x8a7a6a (tan stone), 0x6a5a4a (brown stone)
- Roof: 0xcc4444 (red terracotta), 0x884422 (brown)
- Wood: 0x8a6a4a, 0x6a4a2a
- Foliage: 0x2d8b2d (grass), 0x228B22 (dark green)
- Water: 0x3388cc (transparent blue)
- Windows: 0x88ccff (glass blue)
- Accent: 0x00ffaa (neon cyan for screens/tech)

### Architecture
- **Voxel grid unit**: 1 Three.js unit = 1 "block"
- **Rooms**: Built from stacked voxel cubes (like Minecraft house)
- **Walls**: 1-block thick, 4-blocks tall
- **Roof**: Pyramid or flat voxel slabs, overhanging by 1 block
- **Windows**: 1x1 glass cube in walls

### Scene Layout
```
[Outside World - grass ground]

[COURTYARD - left side]
- Stone courtyard floor
- Benches
- Trees (voxel trunk + cube foliage)
- Flower patches
- Pond/water feature

[GARDEN - right side]  
- Gravel paths
- Trees
- Bushes
- Fountain

[BUILDING - center]
Main office: 20x15 voxel footprint, 5 blocks tall
├── Lobby/Reception (ground floor)
├── Main Office Area (ground floor)
├── Lounge (ground floor)
├── Kitchen (ground floor)
├── Server Room (ground floor)
├── Meeting Room (ground floor)
├── Supply Closet (ground floor)
└── Rooftop garden

[PARKING LOT - behind/side]
- Asphalt voxels
- Parking lines
```

### Voxel Furniture
- **Desk**: 3-wide x 2-deep x 1-tall dark wood block
- **Chair**: Stack of 2 voxel cubes
- **Monitor**: 1x1 voxel with emissive face
- **Plant**: Dirt voxel + green cube on top
- **Tree**: Brown trunk cubes + green foliage cube
- **Lamp**: 1x1 white emissive cube on pole

### Animations
- **Agents**: Simple voxel figures that sway/walk (position oscillation)
- **Plants**: Gentle scale pulse
- **Monitors**: Emissive flicker
- **Server lights**: Random blink
- **Water**: Opacity shimmer

### UI Elements
- Real-time clock (top center)
- Weather widget (Fahrenheit, top right)
- Agent panel (bottom left)

### Key Rules
1. ALL geometry uses `BoxGeometry` only — no spheres, cylinders, cones
2. Camera is FIXED isometric — no OrbitControls
3. Grid-snapped placement
4. Voxel characters (simple stacked cubes)
5. Emissive materials for screens/lights
