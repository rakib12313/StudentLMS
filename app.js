import { auth, db, provider } from './firebase-config.js';
import { 
    signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, 
    signInWithEmailAndPassword, createUserWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, 
    serverTimestamp, where, limit, deleteDoc, updateDoc, arrayUnion, arrayRemove 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- STATE ---
let currentUser = null;
let currentExam = null;
let examTimer = null;
let currentChatNoteId = null;
let currentAssignId = null;
let isExamActive = false;
let cheatWarnings = 2;
let allNotes = [];
let isLoginMode = true;

// --- 1. AUTHENTICATION & DEVICE LOCK FIX ---
async function checkRedirect() {
    try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
            handleUser(result.user);
        }
    } catch (e) {
        alert("Login Error: " + e.message);
    }
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
        } catch (err) { alert(err.message); }
    });
    setupBtn.addEventListener('click', () => {
        isLoginMode = !isLoginMode;
        loginBtn.innerText = isLoginMode ? "Login" : "Create Account";
        setupBtn.innerText = isLoginMode ? "First Time? Create Account" : "Back to Login";
    });
}

document.getElementById('google-login-btn')?.addEventListener('click', () => signInWithRedirect(auth, provider));

onAuthStateChanged(auth, (user) => {
    if (user) handleUser(user);
    else showLoginScreen();
});

async function handleUser(user) {
    try {
        const userRef = doc(db, "students", user.uid);
        let snap = await getDoc(userRef);

        if (snap.exists()) {
            const data = snap.data();
            
            // --- FIX: IMPROVED DEVICE LOCK ---
            let localId = localStorage.getItem('did');
            if (!localId) {
                localId = crypto.randomUUID();
                localStorage.setItem('did', localId);
            }

            // Lock logic: Only lock Students, Admins are exempt for management
            if (data.role !== 'admin' && data.deviceId && data.deviceId !== localId) {
                alert("⛔ Security Alert: This account is linked to another device.");
                await signOut(auth);
                showLoginScreen();
                return;
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
                const newDid = crypto.randomUUID();
                localStorage.setItem('did', newDid);

                await setDoc(userRef, { ...preData, uid: user.uid, approved: true, deviceId: newDid });
                if (s.docs[0].id !== user.uid) await deleteDoc(doc(db, "students", s.docs[0].id));
                currentUser = { ...preData, uid: user.uid, deviceId: newDid };
                initDashboard();
            } else {
                alert("Access Denied: Email not registered.");
                await signOut(auth);
                showLoginScreen();
            }
        }
    } catch (e) { console.error(e); }
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

    updateXPUI(); checkStreak(); loadLive(); loadNotes(); loadVideos(); loadCards(); loadExams(); loadEvents(); loadAssignments(); loadNotifs(); renderAttendance(); loadMyTasks();
}

async function checkMaint() {
    const s = await getDoc(doc(db, "settings", "system"));
    if (s.exists() && s.data().maintenance && currentUser.role !== 'admin') {
        document.body.innerHTML = "<div class='h-screen flex items-center justify-center bg-slate-900 text-white p-4'><h1>System Maintenance</h1></div>";
    }
}

// --- 3. EXAM SYSTEM ---
window.startExam = async (eid) => {
    isExamActive = true; cheatWarnings = 2;
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
            qArea.innerHTML += `<div class="flex items-center justify-between bg-white p-2 mb-2 rounded border"><span class="font-bold text-xs w-6">Q${i+1}</span><div class="flex gap-4">${['A','B','C','D'].map((o,ox)=>`<label><input type="radio" name="q-${i}" value="${ox}"> ${o}</label>`).join('')}</div></div>`;
        }
    } else {
        pdfPanel.classList.add('hidden');
        currentExam.questions.forEach((q, i) => {
            qArea.innerHTML += `<div class="bg-white p-4 mb-3 rounded-xl border shadow-sm"><p class="font-bold text-sm mb-2">Q${i+1}. ${q.text}</p>${q.options.map((o,ox)=>`<label class="block bg-slate-50 p-2 rounded mb-1 text-xs"><input type="radio" name="q-${i}" value="${ox}"> ${o}</label>`).join('')}</div>`;
        });
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
    const total = currentExam.type === "pdf_exam" ? currentExam.answerKey.length : currentExam.questions.length;

    for (let i = 0; i < total; i++) {
        const sel = document.querySelector(`input[name="q-${i}"]:checked`);
        const val = sel ? parseInt(sel.value) : -1;
        userAns.push(val);
        const correct = currentExam.type === "pdf_exam" ? currentExam.answerKey[i] : currentExam.questions[i].correct;
        if (val === correct) score++;
    }

    await updateDoc(doc(db, "students", currentUser.uid), { xp: (currentUser.xp || 0) + (score * 10) });
    await addDoc(collection(db, "results"), { examId: currentExam.id, examTitle: currentExam.title, studentId: currentUser.uid, studentName: currentUser.name, score, total, userAnswers: userAns, submittedAt: serverTimestamp() });
    
    alert(`Score: ${score}/${total}`);
    location.reload();
};

window.openReview = async (eid) => {
    const e = await getDoc(doc(db,"exams",eid)); const ed = e.data();
    const q = query(collection(db,"results"), where("examId","==",eid), where("studentId","==",currentUser.uid));
    const rs = await getDocs(q); const r = rs.docs[0].data();
    document.getElementById('review-modal').classList.remove('hidden');
    const c = document.getElementById('review-content'); c.innerHTML = "";
    if (ed.type === "pdf_exam") {
        c.innerHTML = `<div class="grid grid-cols-5 gap-2">${ed.answerKey.map((k,i)=>`<div class="border p-1 rounded text-[10px] text-center ${r.userAnswers[i]===k?'bg-green-50':'bg-red-50'}">Q${i+1}<br>Key:${['A','B','C','D'][k]}</div>`).join('')}</div>`;
    } else {
        ed.questions.forEach((q,i) => {
            const u = r.userAnswers[i]; const isC = u === q.correct;
            c.innerHTML += `<div class="p-2 border rounded text-xs mb-1 ${isC?'bg-green-50':'bg-red-50'}">Q${i+1}. ${q.text}<br>Correct: ${q.options[q.correct]}</div>`;
        });
    }
};

// --- 4. CONTENT & CHAT ---
async function loadNotes() {
    const batch = currentUser.batch || "all";
    const snaps = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    const list = document.getElementById('notes-list'); list.innerHTML = "";
    snaps.forEach(doc => {
        const n = doc.data();
        if (n.batch === "all" || n.batch === batch) {
            list.innerHTML += `<div class="bg-white p-3 rounded-xl border flex items-center justify-between shadow-sm"><div onclick="openViewer('${n.url}','${n.type}','${doc.id}')" class="flex items-center gap-3 cursor-pointer"><div class="w-8 h-8 rounded bg-blue-50 flex justify-center items-center"><i class="fas fa-file-pdf text-blue-600"></i></div><div><h4 class="font-bold text-xs">${n.title}</h4></div></div><button onclick="speak('${n.title}')"><i class="fas fa-volume-up text-slate-300"></i></button></div>`;
        }
    });
}
window.openViewer = (url, type, id) => { currentChatNoteId = id; document.getElementById('viewer-modal').classList.remove('hidden'); document.getElementById('pdf-frame').src = url; };
window.speak = (txt) => { window.speechSynthesis.speak(new SpeechSynthesisUtterance(txt)); };
window.toggleDiscuss = () => { document.getElementById('discussion-modal').classList.toggle('hidden'); loadChat(); };
async function loadChat() {
    const b = document.getElementById('chat-box'); b.innerHTML = "Loading...";
    const snaps = await getDocs(query(collection(db, "comments"), where("noteId", "==", currentChatNoteId), orderBy("createdAt", "asc")));
    b.innerHTML = "";
    snaps.forEach(doc => { const c = doc.data(); b.innerHTML += `<div class="chat-bubble ${c.userId===currentUser.uid?'chat-mine':'chat-others'}"><b>${c.userName}</b><br>${c.text}</div>`; });
}
window.sendChat = async () => {
    const t = document.getElementById('chat-input').value; if (!t) return;
    await addDoc(collection(db, "comments"), { noteId: currentChatNoteId, userId: currentUser.uid, userName: currentUser.name, text: t, createdAt: serverTimestamp() });
    document.getElementById('chat-input').value = ""; loadChat();
};

// --- 5. CLASSROOM & GAMIFICATION ---
async function loadAssignments() {
    const snaps = await getDocs(collection(db, "assignments"));
    const l = document.getElementById('assignment-list'); l.innerHTML = "";
    snaps.forEach(doc => { const a = doc.data(); l.innerHTML += `<div class="bg-white p-3 rounded border flex justify-between items-center text-xs"><span>${a.title}</span><button onclick="openSubmit('${doc.id}','${a.title}')" class="bg-blue-600 text-white px-2 py-1 rounded">Submit</button></div>`; });
}
window.openSubmit = (id, title) => { currentAssignId = id; document.getElementById('submit-task-title').innerText = title; document.getElementById('submit-modal').classList.remove('hidden'); };
window.submitHomework = async () => {
    const file = document.getElementById('hw-file').files[0];
    const fm = new FormData(); fm.append('file', file); fm.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', { method: 'POST', body: fm });
    const d = await r.json();
    await addDoc(collection(db, "submissions"), { assignmentId: currentAssignId, studentId: currentUser.uid, studentName: currentUser.name, fileUrl: d.secure_url, graded: false, submittedAt: serverTimestamp() });
    alert("Submitted"); document.getElementById('submit-modal').classList.add('hidden');
};

async function checkStreak() {
    const today = new Date().toDateString();
    if (currentUser.lastLogin !== today) {
        const yest = new Date(); yest.setDate(yest.getDate() - 1);
        const s = (currentUser.lastLogin === yest.toDateString()) ? (currentUser.streak || 0) + 1 : 1;
        await updateDoc(doc(db, "students", currentUser.uid), { lastLogin: today, streak: s, attendance: arrayUnion(today) });
        document.getElementById('streak-count').innerText = s;
    } else document.getElementById('streak-count').innerText = currentUser.streak || 0;
}
function renderAttendance() {
    const g = document.getElementById('attendance-grid'); g.innerHTML = "";
    const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
        const d = new Date(new Date().getFullYear(), new Date().getMonth(), i).toDateString();
        g.innerHTML += `<div class="cal-day ${currentUser.attendance?.includes(d)?'cal-present':''}">${i}</div>`;
    }
}
function updateXPUI() {
    const xp = currentUser.xp || 0;
    document.getElementById('xp-text').innerText = xp + " XP";
    document.getElementById('xp-bar').style.width = Math.min((xp / 1000) * 100, 100) + "%";
}

// --- GLOBAL ACTIONS ---
window.switchTab = (tab) => { ['notes', 'videos', 'cards', 'exams', 'tasks', 'events'].forEach(t => { document.getElementById(`view-${t}`).classList.toggle('hidden', t !== tab); document.getElementById(`tab-${t}`).classList.toggle('active-tab', t === tab); }); };
window.toggleTheme = () => document.body.classList.toggle('dark');
window.closeViewer = () => document.getElementById('viewer-modal').classList.add('hidden');
window.openProfileModal = () => document.getElementById('profile-modal').classList.remove('hidden');
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(() => location.reload()));

// Load remaining helpers (Videos, Cards, Events, Tasks, Live, Notifs, etc.)
async function loadVideos() { const s=await getDocs(collection(db,"videos")); const l=document.getElementById('video-list'); l.innerHTML=""; s.forEach(d=>{ const v=d.data(); const vid=v.url.split('v=')[1]?.split('&')[0]; l.innerHTML+=`<div class="bg-white p-2 rounded shadow-sm"><div class="video-wrapper"><iframe src="https://www.youtube.com/embed/${vid}"></iframe></div></div>`; }); }
async function loadCards() { const s=await getDocs(collection(db,"flashcards")); const l=document.getElementById('card-list'); l.innerHTML=""; s.forEach(d=>{ const c=d.data(); l.innerHTML+=`<div class="flashcard-container" onclick="this.classList.toggle('flipped')"><div class="flashcard-inner"><div class="flashcard-front">${c.front}</div><div class="flashcard-back">${c.back}</div></div></div>`; }); }
async function loadEvents() { const s=await getDocs(collection(db,"events")); const l=document.getElementById('events-list'); l.innerHTML=""; s.forEach(d=>{ const e=d.data(); l.innerHTML+=`<div class="bg-white p-2 border rounded-lg text-xs font-bold">${e.title}</div>`; }); }
async function loadMyTasks() { const s=await getDocs(query(collection(db,"tasks"), where("uid","==",currentUser.uid))); const l=document.getElementById('my-task-list'); l.innerHTML=""; s.forEach(d=>{ l.innerHTML+=`<div class="flex justify-between p-1 border-b text-[10px]"><span>${d.data().text}</span><button onclick="delTask('${d.id}')">x</button></div>`; }); }
window.addMyTask = async () => { const t=document.getElementById('my-task-in').value; if(t){ await addDoc(collection(db,"tasks"),{uid:currentUser.uid, text:t}); loadMyTasks(); } };
window.delTask = async (id) => { await deleteDoc(doc(db,"tasks",id)); loadMyTasks(); };
async function loadLive() { const s=await getDoc(doc(db,"settings","live")); if(s.exists()&&s.data().active){ document.getElementById('live-class-card').classList.remove('hidden'); document.getElementById('live-link').href=s.data().url; } }
async function loadAnnouncement() { const s=await getDoc(doc(db,"settings","announcement")); if(s.exists()){ document.getElementById('announcement-area').classList.remove('hidden'); document.getElementById('announcement-text').innerText=s.data().text; } }
async function loadNotifs() { const s=await getDocs(query(collection(db,"notifications"), limit(5))); const l=document.getElementById('notif-dropdown'); l.innerHTML=""; s.forEach(d=>{ l.innerHTML+=`<div class="p-2 border-b text-[10px]">${d.data().title}</div>`; }); }
window.toggleNotifs = () => document.getElementById('notif-dropdown').classList.toggle('hidden');
window.calcApp = (v) => { const d=document.getElementById('calc-display'); if(v==='C')d.value='0'; else if(v==='DEL')d.value=d.value.slice(0,-1); else d.value+=v; };
window.calcSolve = () => { try{ document.getElementById('calc-display').value=eval(document.getElementById('calc-display').value); } catch{ d.value="Err"; } };
