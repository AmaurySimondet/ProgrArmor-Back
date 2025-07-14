import { fetchProfile, fetchSessions } from 'trn-rocket-league';
import fs from 'fs';

const username = 'Muninn._';
const profile = await fetchProfile(username, 'epic');
console.log(profile.ranked);
const sessions = await fetchSessions(username, 'epic');

// session to json
fs.writeFileSync('sessions.json', JSON.stringify(sessions, null, 2));