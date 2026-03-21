# Isometric Office - Complete Rewrite Spec

## Architecture

### File Structure
- Single `office.html` file, ~700 lines
- All JavaScript inline (no build step)
- Three.js from CDN: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`
- OrbitControls from CDN

### Scene Setup
- `frustumSize = 80`, aspect = window ratio
- Camera: `OrthographicCamera`, positioned at `(50, 50, 50)` looking at origin
- Renderer: WebGL, shadow maps enabled, set pixel ratio to device pixel ratio
- Scene background: dark `#0a0a1a`

### Lighting
- `AmbientLight` (0x404060, intensity 0.4)
- `DirectionalLight` (0xffeedd, intensity 0.8) at (30, 60, 30), casts shadows
- Secondary fill light (0x8899cc, intensity 0.3) at (-30, 40, -30)

### Color Palette
- Floor: 0x1a1a2e (dark blue-gray)
- Walls: 0x2a2a4a (medium purple-gray)
- Desk surface: 0x4a3728 (warm wood brown)
- Accent/Neon: 0x00ffaa (cyan-green), 0xff00aa (magenta)
- Sofa: 0x4a4a6a (muted purple)
- Plants: pot 0x8B4513, leaves 0x228B22

### Room Layout (world coordinates)
- **Main Office**: origin (0, 0, 0), ~60x60 units floor
- **Lounge**: at (0, 0, 22), connected by hallway
- **Kitchen**: at (40, 0, 0)
- **Server Room**: at (-40, 0, 0)
- **Meeting Room**: at (-30, 0, 10)
- **Rooftop**: at (0, 12, 0) — elevated 12 units
- **Supply Closet**: at (30, 0, -30)

## Section Assignments

### Agent 1: Scene Setup + Main Office Room (Lines 1-250)
- Three.js scene, camera, renderer, lighting
- Helper functions: `mkBox(w,h,d,color,opts)`, `mkCyl(rt,rb,h,segs,color,opts)`, `mkSphere(r,segs,color,opts)`
- `L(g)` helper = last child = `g.children[g.children.length-1]`
- `add(parent, mesh)` = `parent.add(mesh)`
- Floor plane with grid texture (use checkerboard pattern via procedural UV)
- 4 walls with doors (use gaps in walls, not actual door meshes)
- Ceiling with fluorescent light panels
- Central area with reception desk
- Correct y-placement: ALL floor-hugging objects have their BOTTOM at world y=0

### Agent 2: Furniture - Desks, Chairs, Monitors, Lamps, Plants (Lines 251-500)
- 6 desks in 2 rows of 3
- Each desk has: surface, 4 legs, monitor, keyboard, chair, lamp, mug
- Monitor: flat panel on stand, emissive screen (0x111122 default, slight glow)
- Chair: seat + back + 4 legs (dark gray 0x333344)
- Lamp: base (cylinder) + pole + conical shade, emissive bulb
- Plant: pot (cylinder h=0.25) + 5 leaf spheres, sitting ON desk surface (world y=1.6)
- Desk positions: [{x:-30,z:-25},{x:-30,z:-10},{x:-30,z:5},{x:-8,z:-25},{x:-8,z:-10},{x:-8,z:5}]
- Every object that touches a surface: bottom of object at world y = surface_height

### Agent 3: Other Rooms + Outdoor Elements (Lines 501-700)
- **Lounge** (at 0,0,22): floor, 3 walls, sofa group, coffee table, 2 large potted trees (floor level)
- **Kitchen** (at 40,0,0): counter along wall, refrigerator box, round table with 4 stools
- **Server Room** (at -40,0,0): rack mounts (boxes), blinking status lights (emissive spheres)
- **Meeting Room** (at -30,0,10): oval table, 6 chairs, whiteboard
- **Rooftop** (at 0,12,0): outdoor floor, sky, potted plants, umbrella table
- **Supply Closet** (at 30,0,-30): shelves with box items
- **Hallway** connecting main office to lounge
- **Outdoor trees**: 6 large trees scattered around building perimeter at floor level
- Each room's floor is at world y=0 (same level as main office)
- Trees have: pot (cylinder h=0.8, y=0.4) + trunk (cylinder h=2.5, y=1.25+0.4=1.65) + sphere foliage (r=1.0, y=2.65+1.0=3.65)

### Agent 4: Animations, UI, Weather, Polish (Lines 700-726 + CSS)
- **Animation loop** (`requestAnimationFrame`):
  - Monitor screens: flicker emissiveIntensity (0.8-1.0)
  - Plants: gentle sway (rotation.z and rotation.x using sin/cos)
  - Server racks: blink lights (random emissive toggle)
  - ALL animations check `obj.userData.someProperty` before animating
  - ALL material assignments check `material && material.emissiveIntensity !== undefined`
  - Wrap entire `updateAnimations` in `try-catch` to prevent any crash
- **Weather widget** (top-right overlay):
  - Uses wttr.in API with `?format=j1`
  - Shows: city name, temp in **Fahrenheit** (c.temp_F + "°F"), weather icon, description, humidity%, wind in **mph** (windspeedMiles)
  - Editable city (click to edit, saves to localStorage as "ducklabs_city")
  - Default city: "Huber Heights,OH"
- **Session display** (bottom-left or side panel):
  - Poll `/sessions` on proxy (localhost:18790/sessions)
  - Show agent names/avatars in a small panel
  - If fetch fails, show "X agents online" based on `CONFIG.agentCount`
- **Settings button**: toggles panel visibility
- **Status ring**: small sphere above each agent's desk that pulses

## Key Rules (CRITICAL)

1. **Geometry centering**: `mkBox/Cyl/Sphere` all create CENTERED geometry. If you want bottom at y=0, offset by `-h/2`.
2. **Consistent y-placement**: Desk surface at y=1.6. Objects on desk have their BOTTOM at y=1.6.
3. **Null-safe animations**: Every `.material.emissiveIntensity` line must be guarded.
4. **No code duplication**: Each helper and room function appears exactly once.
5. **Shared state**: `officeObjects = {monitors:[], plants:[], lamps:[], blinkLights:[], chairs:[], desks:[]}` — all animated objects go in here.

## Verification Checklist
Before finishing, test:
- [ ] Page loads without crash
- [ ] No `TypeError` in console
- [ ] Weather shows Fahrenheit (°F), not Celsius
- [ ] Plants sit ON desks, not floating above
- [ ] Animations run without errors
- [ ] Sessions poll shows agent info
