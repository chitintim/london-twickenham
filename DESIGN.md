# Design Document - Mobile-First Approach

## Mobile UI Layout (Primary Design)

```
┌─────────────────────────────────────┐
│  TWICKENHAM → LONDON     [↔ Switch] │  <- Header with direction & switch
├─────────────────────────────────────┤
│                                     │
│  Next Train                        │
│  ┌───────────────────────────────┐ │
│  │ 14:23 → 14:51    Platform 2   │ │  <- Main focus: times & platform
│  │ Departs in 5 min               │ │  <- Urgency indicator
│  │ London Waterloo    On Time     │ │  <- Destination & status
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ 14:35 → 15:03    Platform 2   │ │
│  │ Departs in 17 min              │ │
│  │ London Waterloo    On Time     │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ 14:47 → 15:15    Platform 2   │ │
│  │ Departs in 29 min              │ │
│  │ London Waterloo    On Time     │ │
│  └───────────────────────────────┘ │
│                                     │
│  Last updated: 14:18:30            │  <- Update timestamp
└─────────────────────────────────────┘
```

## Information Hierarchy

### Primary (Largest, Most Prominent)
- Departure time
- "Departs in X minutes" (urgency indicator)
- Platform number

### Secondary
- Arrival time
- Destination station
- Delay status (On Time / Delayed)

### Tertiary
- Last update time
- Direction switch button

## Color Scheme

- **Background**: White/Light gray (#f5f5f5)
- **Text**: Dark gray/Black (#333)
- **On Time**: Green (#28a745)
- **Delayed**: Red (#dc3545)
- **Platform Confirmed**: Blue (#007bff)
- **Platform Predicted**: Orange (#ffc107)

## Mobile-First Design Principles

### Touch Optimization
- **Departure time**: 28px font, bold
- **Platform**: 24px font in colored badge
- **"Departs in X min"**: 20px font, high contrast
- **Touch targets**: Minimum 48px height for all interactive elements
- **Card spacing**: 16px padding for easy thumb reach
- **Switch button**: 56px x 48px for easy tapping while walking

### Screen Real Estate
- **No scrolling needed** for 3 trains on iPhone SE (smallest common screen)
- **Vertical layout only** - no landscape optimization needed
- **Fixed header** with direction and switch
- **Sticky update time** at bottom
- **Full width cards** with 8px margin

### Performance on Mobile
- **Minimal CSS** - no complex animations
- **Lightweight**: < 50KB total page weight
- **No external fonts** - system fonts only
- **Single API call** - batch all data
- **CSS Grid/Flexbox** for native performance

### Mobile-Specific Features
- **Pull to refresh** gesture support
- **Haptic feedback** on switch (where supported)
- **High contrast mode** auto-detection
- **Reduced motion** respect for accessibility
- **Offline detection** with clear messaging

## API Integration Strategy

### Huxley2 Endpoints
- Departures: `https://huxley2.azurewebsites.net/departures/{station_code}`
- No API key required (public proxy)

### Station Codes
- Twickenham: TWI
- London Waterloo: WAT
- London terminals fallback: VIC, CLJ, PAD, KGX, LST, CHX

### Data Processing
1. Fetch all departures from origin station
2. Filter by destination (match station names)
3. Calculate actual arrival times (scheduled + delays)
4. Sort by arrival time
5. Take first 3 results
6. Display with departure time as primary sort

## Error Handling

- Network failures: Show cached data if available
- No trains found: Clear message with troubleshooting
- API down: Fallback message with alternative sources