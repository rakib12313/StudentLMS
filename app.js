import { auth, db, provider } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, serverTimestamp, arrayUnion, orderBy, addDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let user = null;
let allNotes = [];
let isLoginMode = true;

// 1. Auth & Device Lock
async function handleUser(u) {
    const ref = doc(db, "students", u.uid);
    const snap = await getDoc(ref);
    
    if(!snap.exists()) {
        // First check whitelist via email query, if implemented. 
        // For now, assuming email whitelist logic is on Admin side registerStudent
        const q = query(collection(db, "students"), where("email", "==", u.email));
        const s = await getDocs(q);
        
        if(s.empty) { alert("Email not registered by Admin."); signOut(auth); return; }
        
        // Merge Auth UID with Admin Record
        const adminDoc = s.docs[0];
        const data = adminDoc.data();
        await setDoc(ref, { ...data, uid: u.uid, deviceId: getDeviceId() });
        if(adminDoc.id !== u.uid) await deleteDoc(doc(db,"students",adminDoc.id));
        
        user = { ...data, uid: u.uid };
    } else {
        const data = snap.data();
        // DEVICE LOCK CHECK
        const currentDid = getDeviceId();
        if(data.deviceId && data.deviceId !== currentDid) {
            alert("Security Alert: Account locked to another device.");
            signOut(auth); return;
        }
        if(!data.deviceId) await updateDoc(ref, { deviceId: currentDid });
        user = data;
    }

    // Attendance Update
    const today = new Date().toDateString();
    if(!user.attendance || !user.attendance.includes(today)) {
        await updateDoc(ref, { attendance: arrayUnion(today), streak: (user.streak||0)+1 });
    }

    initUI();
}

function getDeviceId() {
    let id = localStorage.getItem('did');
    if(!id) { id = crypto.randomUUID(); localStorage.setItem('did', id); }
    return id;
}

// 2. UI Initialization (Batch Rendering for Performance)
async function initUI() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    // Header
    document.getElementById('nav-name').innerText = user.name || "Student";
    document.getElementById('nav-batch').innerText = `Class ${user.batch || 'Gen'}`;
    document.getElementById('nav-photo').src = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    document.getElementById('p-name').innerText = user.name;
    document.getElementById('p-email').innerText = user.email;
    document.getElementById('profile-pic-lg').src = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    document.getElementById('xp-stat').innerText = user.xp || 0;
    document.getElementById('streak-stat').innerText = user.streak || 0;

    loadLive();
    loadAnnounce();
    loadNotes();
    loadExams();
    renderAttendance();
}

// 3. Fast Data Loading (Batch Filtered)
async function loadNotes() {
    const q = query(collection(db, "notes"), orderBy("createdAt", "desc"));
    const s = await getDocs(q);
    const grid = document.getElementById('notes-grid');
    
    let html = "";
    allNotes = []; // For local search
    
    s.forEach(d => {
        const n = d.data();
        // Batch Filter Logic
        if(n.batch === "all" || n.batch === user.batch) {
            allNotes.push(n);
            html += `
            <div class="glass-card p-4 flex items-center gap-4 cursor-pointer hover:bg-white" onclick="viewPDF('${n.url}')">
                <div class="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600"><i class="fas fa-file-pdf text-xl"></i></div>
                <div>
                    <h4 class="font-bold text-sm text-slate-700">${n.title}</h4>
                    <span class="text-[10px] text-slate-400">Read Now</span>
                </div>
            </div>`;
        }
    });
    grid.innerHTML = html; // Single DOM injection = NO LAG
}

window.filterNotes = () => {
    const term = document.getElementById('search-bar').value.toLowerCase();
    const grid = document.getElementById('notes-grid');
    let html = "";
    allNotes.filter(n => n.title.toLowerCase().includes(term)).forEach(n => {
        html += `
        <div class="glass-card p-4 flex items-center gap-4 cursor-pointer hover:bg-white" onclick="viewPDF('${n.url}')">
            <div class="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600"><i class="fas fa-file-pdf text-xl"></i></div>
            <div><h4 class="font-bold text-sm text-slate-700">${n.title}</h4></div>
        </div>`;
    });
    grid.innerHTML = html;
};

async function loadExams() {
    const s = await getDocs(query(collection(db,"exams"), orderBy("createdAt","desc")));
    const g = document.getElementById('exams-grid');
    let html = "";
    s.forEach(d => {
        const e = d.data();
        if(e.batch === "all" || e.batch === user.batch) {
            html += `
            <div class="glass-card p-4 flex justify-between items-center border-l-4 border-pink-500">
                <div>
                    <h4 class="font-bold text-slate-700 text-sm">${e.title}</h4>
                    <p class="text-[10px] text-slate-400">${e.duration} Mins • ${e.answerKey.length} Questions</p>
                </div>
                <button onclick="startExam('${d.id}')" class="bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg">Start</button>
            </div>`;
        }
    });
    g.innerHTML = html || "<p class='text-center text-slate-400'>No Exams Available</p>";
}

// 4. Live Class & Features
async function loadLive() {
    const s = await getDoc(doc(db, "settings", "live"));
    if(s.exists() && s.data().active) {
        document.getElementById('live-banner').classList.remove('hidden');
        document.getElementById('live-topic-txt').innerText = s.data().topic;
        document.getElementById('live-join-btn').href = s.data().url;
    }
}

async function loadAnnounce() {
    const s = await getDoc(doc(db, "settings", "announcement"));
    if(s.exists()) {
        document.getElementById('announce-box').classList.remove('hidden');
        document.getElementById('announce-txt').innerText = s.data().text;
    }
}

// 5. Exam System (Anti-Cheat Timer)
let currentExam = null;
let timerInt = null;

window.startExam = async (eid) => {
    const s = await getDoc(doc(db, "exams", eid));
    currentExam = { id: s.id, ...s.data() };
    
    document.getElementById('exam-modal').classList.remove('hidden');
    document.getElementById('exam-pdf-view').src = currentExam.fileUrl;
    
    let html = "";
    currentExam.answerKey.forEach((k, i) => {
        html += `
        <div class="p-3 border rounded-lg bg-slate-50 flex justify-between items-center">
            <span class="font-bold text-sm text-slate-600">Q${i+1}</span>
            <div class="flex gap-3">
                ${['A','B','C','D'].map((o,v) => `<label class="font-bold text-slate-500"><input type="radio" name="q${i}" value="${v}"> ${o}</label>`).join('')}
            </div>
        </div>`;
    });
    document.getElementById('exam-qs').innerHTML = html;

    // Timer
    let t = currentExam.duration * 60;
    timerInt = setInterval(() => {
        t--;
        const m = Math.floor(t/60);
        const s = t%60;
        document.getElementById('timer').innerText = `${m}:${s<10?'0'+s:s}`;
        if(t<=0) window.submitExam();
    }, 1000);
};

window.submitExam = async () => {
    clearInterval(timerInt);
    let score = 0;
    const ans = [];
    currentExam.answerKey.forEach((k, i) => {
        const el = document.querySelector(`input[name="q${i}"]:checked`);
        const v = el ? parseInt(el.value) : -1;
        ans.push(v);
        if(v === k) score++;
    });
    
    await addDoc(collection(db,"results"), {
        examId: currentExam.id, score, total: currentExam.answerKey.length, 
        student: user.name, uid: user.uid, batch: user.batch
    });
    
    // Update XP
    await updateDoc(doc(db,"students",user.uid), { xp: (user.xp||0) + (score*10) });
    
    document.getElementById('exam-modal').classList.add('hidden');
    confetti();
    alert(`Finished! Score: ${score}`);
    location.reload();
};

// 6. Profile Helpers
window.uploadPhoto = async (el) => {
    const f = new FormData(); f.append('file', el.files[0]); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
    const d = await r.json();
    await updateDoc(doc(db, "students", user.uid), { photo: d.secure_url });
    location.reload();
};

window.viewPDF = (u) => {
    document.getElementById('viewer-modal').classList.remove('hidden');
    document.getElementById('pdf-frame').src = u;
};

function renderAttendance() {
    const g = document.getElementById('attendance-grid');
    g.innerHTML = "";
    const days = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
    for(let i=1; i<=days; i++) {
        const dStr = new Date(new Date().getFullYear(), new Date().getMonth(), i).toDateString();
        const isPres = user.attendance && user.attendance.includes(dStr);
        g.innerHTML += `<div class="aspect-square rounded ${isPres?'bg-green-500':'bg-slate-200'} text-[8px] flex items-center justify-center text-white">${i}</div>`;
    }
}

// Auth Listeners
document.getElementById('login-btn').addEventListener('click', () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    if(isLoginMode) signInWithEmailAndPassword(auth, e, p).catch(e=>alert(e.message));
    else createUserWithEmailAndPassword(auth, e, p).then(u=>handleUser(u.user)).catch(e=>alert(e.message));
});

document.getElementById('toggle-auth').addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    document.getElementById('login-btn').innerText = isLoginMode ? "Sign In" : "Register";
    document.getElementById('toggle-auth').innerText = isLoginMode ? "First time? Create Account" : "Back to Login";
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(()=>location.reload()));
onAuthStateChanged(auth, u => { if(u) handleUser(u); });