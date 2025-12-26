// app.js
import { auth, db, provider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, serverTimestamp, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;

// --- 1. LOGIN LOGIC ---
const loginBtn = document.getElementById('google-login-btn');

if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        // Save original text
        const originalText = loginBtn.innerHTML;
        
        try {
            // Change button text so you know it clicked
            loginBtn.innerHTML = "⏳ Connecting...";
            loginBtn.disabled = true;

            // Attempt Login
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            
            // If successful, check database
            loginBtn.innerHTML = "🔄 Checking Database...";
            await handleUser(user);

        } catch (error) {
            // 🚨 SHOW ERROR ALERT
            console.error(error);
            alert("LOGIN FAILED!\n\nReason: " + error.message + "\n\n(Did you add rakib12313.github.io to Firebase Authorized Domains?)");
            
            // Reset button
            loginBtn.disabled = false;
            loginBtn.innerHTML = originalText;
        }
    });
}

// --- 2. AUTH LISTENER ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        handleUser(user);
    } else {
        showLoginScreen();
    }
});

// --- 3. USER HANDLING (Strict Mode) ---
async function handleUser(user) {
    try {
        const userRef = doc(db, "students", user.uid);
        let snap = await getDoc(userRef);

        if (snap.exists()) {
            currentUser = snap.data();
            initDashboard();
            return;
        }

        // Check if Admin pre-registered this email
        const q = query(collection(db, "students"), where("email", "==", user.email));
        const querySnap = await getDocs(q);

        if (!querySnap.empty) {
            const preRegDoc = querySnap.docs[0];
            const preRegData = preRegDoc.data();
            
            // Link UID to Email
            await setDoc(userRef, {
                ...preRegData,
                uid: user.uid,
                name: user.displayName,
                photo: user.photoURL,
                role: preRegData.role || 'student',
                approved: true
            });
            
            // Cleanup old doc if needed
            if(preRegDoc.id !== user.uid) await deleteDoc(doc(db, "students", preRegDoc.id));

            currentUser = { ...preRegData, uid: user.uid, name: user.displayName, photo: user.photoURL };
            initDashboard();
        } else {
            // Not registered? Kick them out.
            alert("⛔ Access Denied!\n\nYour email (" + user.email + ") is not registered.\nContact the Admin.");
            await signOut(auth);
            showLoginScreen();
            
            // Reset Button
            if(loginBtn) {
                loginBtn.disabled = false;
                loginBtn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" class="w-5 h-5"><span class="text-sm">Login with Registered Gmail</span>`;
            }
        }
    } catch(err) {
        alert("Database Error: " + err.message);
        if(loginBtn) loginBtn.disabled = false;
    }
}

// --- 4. UI FUNCTIONS ---
function showLoginScreen() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
}

function initDashboard() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    // Set Profile Data
    if(document.getElementById('nav-photo')) document.getElementById('nav-photo').src = currentUser.photo;
    if(document.getElementById('profile-photo')) document.getElementById('profile-photo').src = currentUser.photo;
    if(document.getElementById('profile-name')) document.getElementById('profile-name').innerText = currentUser.name;
    if(document.getElementById('header-name')) document.getElementById('header-name').innerText = currentUser.name.split(' ')[0];
    
    // Load Content
    document.getElementById('main-content').classList.remove('hidden');
    
    if (currentUser.role === 'admin') {
        // Show Admin Tabs
        if(document.getElementById('tab-admin')) document.getElementById('tab-admin').classList.remove('hidden');
        if(document.getElementById('admin-upload-ui')) document.getElementById('admin-upload-ui').classList.remove('hidden');
        if(document.getElementById('admin-exam-ui')) document.getElementById('admin-exam-ui').classList.remove('hidden');
        loadAllUsers();
    }
    
    // Functions from previous versions...
    loadNotes();
    loadExams();
}

// --- 5. LOGOUT ---
document.getElementById('logout-btn')?.addEventListener('click', () => {
    signOut(auth).then(() => location.reload());
});

// --- PLACEHOLDER FUNCTIONS (Copy full logic from v6 if needed) ---
async function loadNotes() { /* ...use v6 logic... */ }
async function loadExams() { /* ...use v6 logic... */ }
async function loadAllUsers() { /* ...use v6 logic... */ }

// Make functions global for HTML buttons
window.switchTab = (tab) => {
    ['notes', 'exams', 'leaderboard', 'admin'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const view = document.getElementById(`view-${t}`);
        if(btn && view) {
            const isActive = t === tab;
            // Simple class toggle for visibility
            view.classList.toggle('hidden', !isActive);
            // Highlight button
            if(isActive) btn.classList.add('text-blue-600', 'bg-white', 'shadow');
            else btn.classList.remove('text-blue-600', 'bg-white', 'shadow');
        }
    });
};

window.openProfileModal = () => document.getElementById('profile-modal').classList.remove('hidden');
