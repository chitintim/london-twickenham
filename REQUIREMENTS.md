# Requirements Specification

## Core Requirements

### Display Logic
1. **Show 3 trains** sorted by earliest arrival time at destination
2. **Time-based direction**:
   - Before 14:00 UK time: Twickenham → London
   - After 14:00 UK time: London → Twickenham
3. **Manual override**: Button to switch direction regardless of time

### Data Requirements
1. **Departure time** (scheduled and actual if delayed)
2. **Arrival time** (scheduled and actual if delayed)
3. **Platform number** with confidence indicator (predicted/confirmed)
4. **Delay information** integrated into times
5. **Station names** for clarity

### Sorting & Filtering
1. **Primary sort**: By actual arrival time (scheduled + delays)
2. **Display order**: By departure time for user convenience
3. **Filter out**:
   - Trains that have already departed
   - Trains not going to target destination
   - Cancelled services

### Technical Requirements
1. **Hosting**: GitHub Pages (static site only)
2. **API**: Huxley2 (no authentication required)
3. **Updates**: Auto-refresh every 30 seconds
4. **Performance**: Page load < 2 seconds
5. **Compatibility**: Mobile-first, works on all modern browsers

## User Stories

### As a commuter rushing to catch a train:
- I want to see departure times immediately
- I want to know which platform without scrolling
- I want to see if I can make the next train (time until departure)
- I want to know about delays upfront

### As an evening commuter:
- I want the app to automatically show return journeys after 2pm
- I want to manually switch if I'm traveling at an unusual time
- I want to see accurate arrival times to plan my journey

## Non-Functional Requirements

### Performance
- Initial load: < 2 seconds
- API response handling: < 1 second
- Smooth animations and transitions

### Usability
- One-glance information gathering
- No login or setup required
- Works offline with cached data
- Clear error messages

### Accessibility
- High contrast colors
- Large, readable fonts
- Semantic HTML structure
- Keyboard navigable

## Out of Scope

- Journey planning beyond next 3 trains
- Ticket purchasing
- Historical data
- Multi-leg journeys
- Service alerts/disruptions details
- User preferences/settings storage