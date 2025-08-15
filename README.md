# London-Twickenham Train Tracker

A simple, fast-loading website that displays real-time train information between Twickenham and London stations, optimized for quick glances when you're rushing out the door.

## Features

- **Smart Direction Detection**: Automatically shows Twickenham → London trains before 2pm, London → Twickenham after 2pm
- **Next 3 Trains**: Displays the 3 most relevant trains based on arrival time
- **Real-time Updates**: Shows live departure/arrival times with delay information
- **Platform Information**: Shows both predicted and confirmed platforms
- **Manual Override**: Quick button to switch direction when needed
- **Mobile-First Design**: Large, readable text for checking on the go

## Key Information Displayed

When rushing, you need to know:
1. **Can I make it?** - Departure time prominently displayed
2. **Which platform?** - Clear platform numbers with confidence indicators
3. **When will I arrive?** - Arrival times with any delays factored in
4. **Is it delayed?** - Visual indicators for delays

## Technical Details

- **Hosted on**: GitHub Pages
- **API**: Huxley2 (proxy for National Rail, no API key required)
- **Main Stations**: 
  - Twickenham (TWI)
  - London Waterloo (WAT) - primary London terminus
  - Other London terminals as fallback

## Local Testing

Due to CORS restrictions, the site must be served via HTTP (not file://).

### Option 1: Python (if installed)
```bash
python3 -m http.server 8000
# Then visit http://localhost:8000
```

### Option 2: Node.js (if installed)
```bash
npx http-server
# Then visit http://localhost:8080
```

### Option 3: Deploy to GitHub Pages
The site works perfectly when hosted on GitHub Pages without any setup.

## Project Structure

```
/
├── index.html       # Main page
├── style.css        # Simple, readable styling
├── script.js        # Train data fetching and display logic
└── README.md        # This file
```

## How It Works

1. Checks current time to determine default direction
2. Fetches departures from Huxley API
3. Filters for relevant destinations
4. Sorts by actual arrival time (accounting for delays)
5. Displays top 3 results with clear, rush-friendly formatting

## Design Principles

- **Speed over beauty**: Fast loading, instant information
- **Clarity**: Large fonts, high contrast, essential info only
- **Smart defaults**: Right direction at the right time
- **Reliability**: Handles API errors gracefully