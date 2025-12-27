import { auth, db, provider } from './firebase-config.js';
import { 
    signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, 
    signInWithEmailAndPassword, createUserWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, 
    serverTimestamp, where, limit, deleteDoc, updateDoc, arrayUnion 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- STATE ---
let currentUser = null;
let currentExam = null;
let examTimer = null;
let currentChatNoteId = null;
let currentAssignId = null;
let isExamActive = false;
let isLoginMode = true;

// --- 1. AUTHENTICATION ---
async function checkRedirect() {
    try {
        const result = await getRedirectResult(auth);
        if (result && result.user) handleUser(result.user);
    } catch (e) { alert("Login Error: " + e.message); }
}
checkRedirect();

const loginBtn = document.getElementById('email-login-btn');
const setupBtn = document.getElementById('setup-btn');

if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        const e = document.getElementById('email').value.trim();
        const p = document.getElementById('password').value;
        if (!e || !p) return alert("Enter details.");
        try {
            if (isLoginMode) await signInWithEmailAndPassword(auth, e, p);
            else {
                const q = query(collection(db, "students"), where("email", "==", e));
                const snap = await getDocs(q);
                if (snap.empty) throw new Error("Email not registered by Admin.");
                const uc = await createUserWithEmailAndPassword(auth, e, p);
                await handleUser(uc.user);
            }
        } catch (err) { 
            document.getElementById('login-status').innerText = err.message;
        }
    });
    setupBtn.addEventListener('click', () => {
        isLoginMode = !isLoginMode;
        loginBtn.innerText = isLoginMode ? "LOGIN" : "CREATE ACCOUNT";
        setupBtn.innerText = isLoginMode ? "First Time? Create Account" : "Back to Login";
    });
}

document.getElementById('google-login-btn')?.addEventListener('click', () => signInWithRedirect(auth, provider));

onAuthStateChanged(auth, (user) => {
    if (user) handleUser(user);
    else showLoginScreen();
});

async function handleUser(user) {
    const userRef = doc(db, "students", user.uid);
    let snap = await getDoc(userRef);

    if (snap.exists()) {
        const data = snap.data();
        let localId = localStorage.getItem('did');
        if (!localId) { localId = crypto.randomUUID(); localStorage.setItem('did', localId); }

        if (data.role !== 'admin' && data.deviceId && data.deviceId !== localId) {
            alert("⛔ Account locked to another device.");
            await signOut(auth); showLoginScreen(); return;
        }
        if (!data.deviceId) await updateDoc(userRef, { deviceId: localId });

        currentUser = data;
        initDashboard();
    } else {
        // Whitelist Check
        const q = query(collection(db, "students"), where("email", "==", user.email));
        const s = await getDocs(q);
        if (!s.empty) {
            const preData = s.docs[0].data();
            const newDid = crypto.randomUUID(); localStorage.setItem('did', newDid);
            await setDoc(userRef, { ...preData, uid: user.uid, approved: true, deviceId: newDid });
            if (s.docs[0].id !== user.uid) await deleteDoc(doc(db, "students", s.docs[0].id));
            currentUser = { ...preData, uid: user.uid, deviceId: newDid };
            initDashboard();
        } else {
            alert("Access Denied."); signOut(auth);
        }
    }
}

function showLoginScreen() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
}

// --- 2. DASHBOARD INIT ---
function initDashboard() {
    checkMaint();
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    document.getElementById('header-name').innerText = currentUser.name.split(' ')[0];
    document.getElementById('nav-photo').src = currentUser.photo || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
    document.getElementById('profile-name').innerText = currentUser.name;
    document.getElementById('profile-photo').src = currentUser.photo || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
    if (currentUser.role === 'admin') document.getElementById('admin-link-btn').classList.remove('hidden');

    updateXPUI(); checkStreak(); loadLive(); loadNotes(); loadVideos(); loadCards(); loadExams(); loadEvents(); loadAssignments(); loadNotifs(); renderAttendance(); loadMyTasks(); loadAnnouncement();
}

async function checkMaint() {
    const s = await getDoc(doc(db, "settings", "system"));
    if (s.exists() && s.data().maintenance && currentUser.role !== 'admin') {
        document.body.innerHTML = "<div class='h-screen flex items-center justify-center bg-slate-900 text-white p-4'><h1>System Under Maintenance</h1></div>";
    }
}

// --- 3. EXAM SYSTEM (With Confetti) ---
window.startExam = async (eid) => {
    isExamActive = true;
    const docSnap = await getDoc(doc(db, "exams", eid));
    currentExam = { id: docSnap.id, ...docSnap.data() };
    
    document.getElementById('exam-taker-modal').classList.remove('hidden');
    document.getElementById('taking-exam-title').innerText = currentExam.title;
    const qArea = document.getElementById('exam-questions-area'); qArea.innerHTML = "";
    const pdfPanel = document.getElementById('pdf-panel');

    if (currentExam.type === "pdf_exam") {
        pdfPanel.classList.remove('hidden');
        document.getElementById('exam-pdf-frame').src = currentExam.fileUrl;
        for (let i = 0; i < currentExam.answerKey.length; i++) {
            qArea.innerHTML += `
            <div class="glass-panel p-3 mb-3 flex items-center justify-between">
                <span class="font-bold text-slate-700 dark:text-white w-8">Q${i+1}</span>
                <div class="flex gap-4">
                    ${['A','B','C','D'].map((o,ox)=>`<label class="cursor-pointer hover:text-blue-600 font-bold"><input type="radio" name="q-${i}" value="${ox}" class="accent-blue-600"> ${o}</label>`).join('')}
                </div>
            </div>`;
        }
    } else {
        pdfPanel.classList.add('hidden');
        // Standard Qs logic...
    }

    let time = currentExam.duration * 60;
    examTimer = setInterval(() => {
        time--;
        const m = Math.floor(time / 60); const s = time % 60;
        document.getElementById('timer-display').innerText = `${m}:${s<10?'0'+s:s}`;
        if (time <= 0) submitExam();
    }, 1000);
};

window.submitExam = async () => {
    clearInterval(examTimer); isExamActive = false;
    let score = 0; const userAns = [];
    const total = currentExam.type === "pdf_exam" ? currentExam.answerKey.length : 0;

    for (let i = 0; i < total; i++) {
        const sel = document.querySelector(`input[name="q-${i}"]:checked`);
        const val = sel ? parseInt(sel.value) : -1;
        userAns.push(val);
        if (currentExam.type === "pdf_exam" && val === currentExam.answerKey[i]) score++;
    }

    await updateDoc(doc(db, "students", currentUser.uid), { xp: (currentUser.xp || 0) + (score * 10) });
    await addDoc(collection(db, "results"), { examId: currentExam.id, examTitle: currentExam.title, studentId: currentUser.uid, studentName: currentUser.name, score, total, userAnswers: userAns, submittedAt: serverTimestamp() });
    
    document.getElementById('exam-taker-modal').classList.add('hidden');
    
    // UI Feedback
    if(window.triggerConfetti) window.triggerConfetti();
    alert(`Exam Submitted! Score: ${score}/${total}`);
    location.reload();
};

// --- 4. CONTENT LOADING (New UI Templates) ---
async function loadNotes() {
    const batch = currentUser.batch || "all";
    const snaps = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    const list = document.getElementById('notes-list'); list.innerHTML = "";
    snaps.forEach(doc => {
        const n = doc.data();
        if (n.batch === "all" || n.batch === batch) {
            list.innerHTML += `
            <div class="glass-card p-4 flex items-center justify-between group cursor-pointer" onclick="openViewer('${n.url}','${n.type}','${doc.id}')">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex justify-center items-center shadow-sm group-hover:scale-110 transition">
                        <i class="fas ${n.type==='pdf'?'fa-file-pdf':'fa-image'} text-xl"></i>
                    </div>
                    <div>
                        <h4 class="font-bold text-slate-800 dark:text-white text-sm group-hover:text-blue-600 transition">${n.title}</h4>
                        <p class="text-[10px] text-slate-400">Tap to view • Read mode</p>
                    </div>
                </div>
                <button onclick="event.stopPropagation(); speak('${n.title}')" class="w-8 h-8 rounded-full bg-slate-50 hover:bg-blue-50 text-slate-400 hover:text-blue-500 transition flex items-center justify-center">
                    <i class="fas fa-volume-up"></i>
                </button>
            </div>`;
        }
    });
}

async function loadAssignments() {
    const snaps = await getDocs(collection(db, "assignments"));
    const l = document.getElementById('assignment-list'); l.innerHTML = "";
    snaps.forEach(doc => { 
        const a = doc.data(); 
        l.innerHTML += `
        <div class="glass-card p-4 flex justify-between items-center">
            <div>
                <span class="block font-bold text-sm text-slate-800 dark:text-white">${a.title}</span>
                <span class="text-[10px] text-slate-500">Due: ${a.dueDate || 'No Date'}</span>
            </div>
            <button onclick="openSubmit('${doc.id}','${a.title}')" class="bg-white border border-blue-100 text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition">
                Upload
            </button>
        </div>`; 
    });
}

async function loadVideos() {
    const s = await getDocs(collection(db,"videos")); const l=document.getElementById('video-list'); l.innerHTML=""; 
    s.forEach(d=>{ 
        const v=d.data(); const vid=v.url.split('v=')[1]?.split('&')[0]; 
        l.innerHTML+=`
        <div class="glass-card p-2 group hover:-translate-y-1 transition">
            <div class="video-wrapper rounded-xl overflow-hidden shadow-md"><iframe src="https://www.youtube.com/embed/${vid}" allowfullscreen></iframe></div>
            <p class="p-2 font-bold text-xs text-center text-slate-700 dark:text-white">${v.title}</p>
        </div>`; 
    }); 
}

async function loadCards() { 
    const s=await getDocs(collection(db,"flashcards")); const l=document.getElementById('card-list'); l.innerHTML=""; 
    s.forEach(d=>{ 
        const c=d.data(); 
        l.innerHTML+=`
        <div class="flashcard-container group" onclick="this.classList.toggle('flipped')">
            <div class="flashcard-inner">
                <div class="flashcard-front">
                    <div>
                        <p class="text-xs uppercase text-slate-400 font-bold mb-2">Question</p>
                        ${c.front}
                    </div>
                </div>
                <div class="flashcard-back">
                    <div>
                        <p class="text-xs uppercase text-white/70 font-bold mb-2">Answer</p>
                        ${c.back}
                    </div>
                </div>
            </div>
        </div>`; 
    }); 
}

async function loadExams() {
    const s=await getDocs(collection(db,"exams")); const l=document.getElementById('exams-list'); l.innerHTML="";
    s.forEach(d => {
        const e = d.data();
        l.innerHTML += `
        <div class="glass-card p-4 flex justify-between items-center border-l-4 border-l-purple-500">
            <div>
                <h4 class="font-bold text-slate-800 dark:text-white text-sm">${e.title}</h4>
                <p class="text-xs text-slate-500">${e.duration} Mins • ${e.type === 'pdf_exam' ? 'PDF Mode' : 'Quiz Mode'}</p>
            </div>
            <button onclick="startExam('${d.id}')" class="btn-primary px-5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-purple-500/30">Start</button>
        </div>`;
    });
}

// --- 5. HELPERS & GLOBAL ---
window.submitHomework = async () => {
    const file = document.getElementById('hw-file').files[0];
    if(!file) return alert("Select a file");
    const fm = new FormData(); fm.append('file', file); fm.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', { method: 'POST', body: fm });
    const d = await r.json();
    await addDoc(collection(db, "submissions"), { assignmentId: currentAssignId, studentId: currentUser.uid, studentName: currentUser.name, fileUrl: d.secure_url, graded: false, submittedAt: serverTimestamp() });
    
    document.getElementById('submit-modal').classList.add('hidden');
    if(window.triggerConfetti) window.triggerConfetti();
    alert("Great job! Homework Submitted.");
};

window.openViewer = (url, type, id) => { 
    currentChatNoteId = id; 
    document.getElementById('viewer-modal').classList.remove('hidden'); 
    if(type==='pdf') {
        document.getElementById('pdf-frame').src = url; 
        document.getElementById('pdf-frame').classList.remove('hidden');
        document.getElementById('image-frame').classList.add('hidden');
    } else {
        document.getElementById('image-frame').src = url;
        document.getElementById('image-frame').classList.remove('hidden');
        document.getElementById('pdf-frame').classList.add('hidden');
    }
};

window.switchTab = (tab) => { 
    ['notes', 'videos', 'cards', 'exams', 'tasks', 'events'].forEach(t => { 
        document.getElementById(`view-${t}`).classList.toggle('hidden', t !== tab); 
        const btn = document.getElementById(`tab-${t}`);
        if(btn) {
            btn.classList.toggle('active-tab', t === tab); 
            btn.classList.toggle('inactive-tab', t !== tab);
        }
    }); 
};

// Loaders
async function loadEvents() { const s=await getDocs(collection(db,"events")); document.getElementById('events-list').innerHTML = s.docs.map(d=>`<div class="glass-card p-3 text-xs font-bold border-l-4 border-blue-500">${d.data().title}</div>`).join(''); }
async function loadMyTasks() { const s=await getDocs(query(collection(db,"tasks"), where("uid","==",currentUser.uid))); document.getElementById('my-task-list').innerHTML = s.docs.map(d=>`<div class="glass-card p-2 flex justify-between items-center text-xs mb-1"><span>${d.data().text}</span><button onclick="delTask('${d.id}')" class="text-red-400 hover:text-red-600">×</button></div>`).join(''); }
window.addMyTask = async () => { const t=document.getElementById('my-task-in').value; if(t){ await addDoc(collection(db,"tasks"),{uid:currentUser.uid, text:t}); document.getElementById('my-task-in').value=""; loadMyTasks(); } };
window.delTask = async (id) => { await deleteDoc(doc(db,"tasks",id)); loadMyTasks(); };
async function loadLive() { const s=await getDoc(doc(db,"settings","live")); if(s.exists()&&s.data().active){ document.getElementById('live-class-card').classList.remove('hidden'); document.getElementById('live-link').href=s.data().url; document.getElementById('live-topic').innerText=s.data().topic; } }
async function loadAnnouncement() { const s=await getDoc(doc(db,"settings","announcement")); if(s.exists()){ document.getElementById('announcement-area').classList.remove('hidden'); document.getElementById('announcement-text').innerText=s.data().text; } }
async function loadNotifs() { const s=await getDocs(query(collection(db,"notifications"), limit(5))); const l=document.getElementById('notif-dropdown'); s.forEach(d=>{ l.innerHTML+=`<div class="p-3 border-b hover:bg-slate-50 text-[10px] text-slate-600">${d.data().title}</div>`; }); }
window.toggleNotifs = () => document.getElementById('notif-dropdown').classList.toggle('hidden');
window.closeViewer = () => document.getElementById('viewer-modal').classList.add('hidden');
window.openProfileModal = () => document.getElementById('profile-modal').classList.remove('hidden');
window.toggleTheme = () => document.body.classList.toggle('dark');
window.calcApp = (v) => { const d=document.getElementById('calc-display'); if(v==='C')d.value='0'; else if(v==='DEL')d.value=d.value.slice(0,-1); else d.value+=v; };
window.calcSolve = () => { try{ document.getElementById('calc-display').value=eval(document.getElementById('calc-display').value); } catch{ d.value="Err"; } };
window.speak = (txt) => { window.speechSynthesis.speak(new SpeechSynthesisUtterance(txt)); };
window.toggleDiscuss = () => { document.getElementById('discussion-modal').classList.toggle('hidden'); loadChat(); };
async function loadChat() {
    const b = document.getElementById('chat-box'); 
    const snaps = await getDocs(query(collection(db, "comments"), where("noteId", "==", currentChatNoteId), orderBy("createdAt", "asc")));
    b.innerHTML = "";
    snaps.forEach(doc => { 
        const c = doc.data(); 
        const isMe = c.userId===currentUser.uid;
        b.innerHTML += `
        <div class="flex flex-col ${isMe?'items-end':'items-start'} mb-2">
            <div class="${isMe?'bg-indigo-600 text-white rounded-br-none':'bg-white border text-slate-700 rounded-bl-none'} px-4 py-2 rounded-2xl shadow-sm max-w-[80%] text-xs">
                <span class="block font-bold text-[9px] opacity-70 mb-1">${c.userName}</span>
                ${c.text}
            </div>
        </div>`; 
    });
}
window.sendChat = async () => {
    const t = document.getElementById('chat-input').value; if (!t) return;
    await addDoc(collection(db, "comments"), { noteId: currentChatNoteId, userId: currentUser.uid, userName: currentUser.name, text: t, createdAt: serverTimestamp() });
    document.getElementById('chat-input').value = ""; loadChat();
};
window.saveProfile = async () => {
    const p = document.getElementById('edit-phone').value;
    const b = document.getElementById('edit-bio').value;
    await updateDoc(doc(db,"students",currentUser.uid), { phone: p, bio: b });
    alert("Profile Saved!"); document.getElementById('profile-modal').classList.add('hidden');
};
window.uploadProfilePhoto = async (input) => {
    const file = input.files[0];
    const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
    const d = await r.json();
    await updateDoc(doc(db,"students",currentUser.uid), { photo: d.secure_url });
    location.reload();
};
function renderAttendance() {
    const g = document.getElementById('attendance-grid'); g.innerHTML = "";
    const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
        const d = new Date(new Date().getFullYear(), new Date().getMonth(), i).toDateString();
        const present = currentUser.attendance?.includes(d);
        g.innerHTML += `<div class="aspect-square rounded flex items-center justify-center font-bold ${present?'bg-green-500 text-white shadow-lg shadow-green-500/30':'bg-slate-200 text-slate-400'}">${i}</div>`;
    }
}
function checkStreak() { document.getElementById('streak-count').innerText = (currentUser.streak||0) + " Days"; }
function updateXPUI() {
    const xp = currentUser.xp || 0;
    document.getElementById('xp-text').innerText = `${xp} XP • Level ${Math.floor(xp/100)+1}`;
    document.getElementById('xp-bar').style.width = Math.min((xp%1000)/10, 100) + "%";
}
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(() => location.reload()));
