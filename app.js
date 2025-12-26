// app.js
import { auth, db, provider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, serverTimestamp, updateDoc, where, limit, deleteDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let currentUser = null;
let currentExam = null;
let examTimer = null;
let allNotes = [];
let allExams = [];

// --- UTILS ---
function showToast(msg, type = 'neutral') {
    const box = document.getElementById('toast-container');
    const el = document.createElement('div');
    const icon = type === 'success' ? 'check-circle text-green-400' : (type === 'error' ? 'exclamation-circle text-red-400' : 'info-circle text-blue-400');
    el.className = "toast";
    el.innerHTML = `<i class="fas fa-${icon}"></i> <span>${msg}</span>`;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// --- AUTH & STRICT LOGIN LOGIC ---
document.getElementById('google-login-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('google-login-btn');
    const oldText = btn.innerHTML;
    try {
        btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Checking Access...`;
        const res = await signInWithPopup(auth, provider);
        await handleUser(res.user);
    } catch(e) { 
        showToast(e.message, 'error'); 
        btn.innerHTML = oldText;
        await signOut(auth); // Ensure logout on error
    }
});

document.getElementById('logout-btn')?.addEventListener('click', () => {
    signOut(auth).then(() => location.reload());
});

onAuthStateChanged(auth, (user) => {
    if (user) handleUser(user);
    else showLoginScreen();
});

async function handleUser(user) {
    // 1. Check if user exists in DB by ID (Fastest)
    const userRef = doc(db, "students", user.uid);
    let snap = await getDoc(userRef);

    if (snap.exists()) {
        // User already logged in before and is valid
        currentUser = snap.data();
        initDashboard();
        return;
    }

    // 2. If not found by UID, check if email is Pre-Registered (By Admin)
    const q = query(collection(db, "students"), where("email", "==", user.email));
    const querySnap = await getDocs(q);

    if (!querySnap.empty) {
        // Email Found! Link Auth UID to this pre-registered doc
        const preRegDoc = querySnap.docs[0];
        const preRegData = preRegDoc.data();
        
        // Update the doc: Set the real UID and Photo
        await setDoc(userRef, {
            ...preRegData,
            uid: user.uid,
            name: user.displayName,
            photo: user.photoURL,
            role: preRegData.role || 'student',
            approved: true
        });
        
        // Delete the old placeholder doc if it had a different ID (Optional cleanup)
        if(preRegDoc.id !== user.uid) await deleteDoc(doc(db, "students", preRegDoc.id));

        currentUser = { ...preRegData, uid: user.uid, name: user.displayName, photo: user.photoURL };
        initDashboard();
    } else {
        // 3. REJECT USER: Email not in DB
        showToast("Access Denied: Your email is not registered.", "error");
        await signOut(auth);
        showLoginScreen();
        // Optional: Reset button UI
        document.getElementById('google-login-btn').innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" class="w-5 h-5"><span class="text-sm">Login with Registered Gmail</span>`;
    }
}

function showLoginScreen() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
}

function initDashboard() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    document.getElementById('nav-photo').src = currentUser.photo;
    document.getElementById('profile-photo').src = currentUser.photo;
    document.getElementById('profile-name').innerText = currentUser.name;
    document.getElementById('profile-email').innerText = currentUser.email;
    document.getElementById('header-name').innerText = currentUser.name.split(' ')[0];
    document.getElementById('profile-role').innerText = currentUser.role.toUpperCase();

    document.getElementById('main-content').classList.remove('hidden');
    loadAnnouncement();

    if (currentUser.role === 'admin') {
        document.getElementById('admin-upload-ui').classList.remove('hidden');
        document.getElementById('admin-exam-ui').classList.remove('hidden');
        document.getElementById('edit-announce-btn').classList.remove('hidden');
        document.getElementById('tab-admin').classList.remove('hidden');
        loadAllUsers();
        loadAdminContent();
    } else {
        document.getElementById('student-score-card').classList.remove('hidden');
        loadMyResults();
    }
    loadNotes(); loadExams(); loadLeaderboard();
}

// --- ADMIN: REGISTER STUDENT ---
window.registerStudent = async () => {
    const emailInput = document.getElementById('new-student-email');
    const email = emailInput.value.trim();
    if(!email) return showToast("Enter an email", "error");

    // Check if exists
    const q = query(collection(db, "students"), where("email", "==", email));
    const snap = await getDocs(q);
    if(!snap.empty) return showToast("Email already registered", "error");

    // Add placeholder doc
    await addDoc(collection(db, "students"), {
        email: email,
        name: "New Student", // Will update on first login
        role: "student",
        approved: true, // Auto-approve since Admin added them
        photo: "https://cdn-icons-png.flaticon.com/512/149/149071.png"
    });

    showToast("Student Registered!", "success");
    emailInput.value = "";
    loadAllUsers();
};

// --- TABS ---
window.switchTab = (tab) => {
    ['notes', 'exams', 'leaderboard', 'admin'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const view = document.getElementById(`view-${t}`);
        if(btn) {
            btn.className = t === tab ? "flex-1 py-2 text-xs font-bold rounded-lg bg-white shadow text-blue-600 transition" : "flex-1 py-2 text-xs font-medium rounded-lg text-gray-400 hover:bg-gray-50 transition";
            view?.classList.toggle('hidden', t !== tab);
        }
    });
};

// --- SEARCH ---
document.getElementById('global-search').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    renderNotes(allNotes.filter(n => n.title.toLowerCase().includes(term)));
    renderExams(allExams.filter(e => e.title.toLowerCase().includes(term)));
});

// --- NOTES (CLOUDINARY) ---
document.getElementById('upload-btn')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('note-file');
    const title = document.getElementById('note-title').value;
    const btn = document.getElementById('upload-btn');
    const status = document.getElementById('upload-status');

    // 🔴 CLOUDINARY
    const CLOUD_NAME = "dpe74ejhl"; 
    const UPLOAD_PRESET = "lms_upload"; 

    if(fileInput.files.length === 0 || !title) return showToast("Missing fields", 'error');

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('upload_preset', UPLOAD_PRESET);

    btn.disabled = true; btn.innerText = "Uploading...";
    status.innerText = "Uploading to cloud...";

    try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if(data.error) throw new Error(data.error.message);

        let type = 'image';
        if(data.format === 'pdf' || fileInput.files[0].name.endsWith('.pdf')) type = 'pdf';

        await addDoc(collection(db, "notes"), { title, url: data.secure_url, type, createdAt: serverTimestamp() });
        showToast("Uploaded!", 'success');
        fileInput.value = ""; document.getElementById('note-title').value = ""; status.innerText = "";
        loadNotes();
        if(currentUser.role === 'admin') loadAdminContent(); // Refresh admin list
    } catch(e) { showToast(e.message, 'error'); }
    btn.disabled = false; btn.innerText = "Upload";
});

async function loadNotes() {
    document.getElementById('notes-skeleton').classList.remove('hidden');
    document.getElementById('notes-list').classList.add('hidden');
    const snaps = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    allNotes = []; snaps.forEach(doc => allNotes.push(doc.data()));
    renderNotes(allNotes);
    document.getElementById('notes-skeleton').classList.add('hidden');
    document.getElementById('notes-list').classList.remove('hidden');
}

function renderNotes(notes) {
    const list = document.getElementById('notes-list'); list.innerHTML = "";
    if(notes.length === 0) list.innerHTML = `<div class="text-center py-6 text-gray-300 text-xs">No notes found</div>`;
    notes.forEach(n => {
        const icon = n.type === 'pdf' ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500';
        list.innerHTML += `
        <div onclick="openViewer('${n.url}', '${n.type}')" class="bg-white p-3 rounded-xl border border-gray-100 flex items-center gap-3 active:scale-[0.98] transition cursor-pointer">
            <div class="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center"><i class="fas ${icon}"></i></div>
            <div class="flex-grow"><h4 class="font-bold text-gray-700 text-xs">${n.title}</h4><span class="text-[10px] text-gray-400 uppercase">${n.type}</span></div>
            <i class="fas fa-chevron-right text-gray-200 text-xs"></i>
        </div>`;
    });
}

window.openViewer = (url, type) => {
    document.getElementById('viewer-modal').classList.remove('hidden');
    const wm = document.getElementById('watermark-overlay');
    wm.innerHTML = ""; for(let i=0;i<30;i++) wm.innerHTML += `<div class="watermark-text">${currentUser.email}</div>`;
    const pdf = document.getElementById('pdf-frame'); const img = document.getElementById('image-frame');
    if(type === 'pdf') { pdf.src = url; pdf.classList.remove('hidden'); img.classList.add('hidden'); }
    else { img.src = url; img.classList.remove('hidden'); pdf.classList.add('hidden'); }
};
window.closeViewer = () => { document.getElementById('viewer-modal').classList.add('hidden'); document.getElementById('pdf-frame').src = ""; };

// --- EXAMS ---
window.openExamCreator = () => document.getElementById('exam-creator-modal').classList.remove('hidden');
window.closeExamCreator = () => document.getElementById('exam-creator-modal').classList.add('hidden');

window.addQuestionField = () => {
    const c = document.getElementById('questions-container');
    const div = document.createElement('div');
    div.className = "bg-white p-3 rounded-lg border border-gray-200 q-block relative animate-fade-in";
    div.innerHTML = `
        <div class="absolute right-2 top-2 text-[10px] font-bold text-gray-300">Q${c.children.length+1}</div>
        <input class="w-full border-b border-gray-100 p-2 mb-2 font-bold text-sm q-text outline-none" placeholder="Question...">
        <div class="grid gap-2 mb-2">${[1,2,3,4].map(i => `<input class="bg-gray-50 border-none p-2 rounded text-xs q-opt${i}" placeholder="Opt ${i}">`).join('')}</div>
        <select class="w-full bg-blue-50 text-blue-600 p-2 rounded text-xs font-bold q-correct border-none"><option value="1">Ans: 1</option><option value="2">Ans: 2</option><option value="3">Ans: 3</option><option value="4">Ans: 4</option></select>
    `;
    c.appendChild(div);
};

window.publishExam = async () => {
    const title = document.getElementById('new-exam-title').value;
    const dur = document.getElementById('new-exam-duration').value;
    const qBlocks = document.querySelectorAll('.q-block');
    if(!title || !dur |