import { auth, db } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, getDoc, setDoc, collection, getDocs, query, orderBy, serverTimestamp, where, limit, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentExam = null;
let examTimer = null;
let allNotes = [];

// --- LOGIN & REGISTER LOGIC ---
const emailInput = document.getElementById('email');
const passInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const setupBtn = document.getElementById('setup-btn');
const statusMsg = document.getElementById('status-msg');

if(loginBtn) {
    // 1. LOGIN MODE
    loginBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const pass = passInput.value.trim();
        if(!email || !pass) return showStatus("Enter email and password", "red");

        try {
            loginBtn.innerText = "Verifying...";
            loginBtn.disabled = true;
            await signInWithEmailAndPassword(auth, email, pass);
            // Auth listener handles the rest
        } catch(e) {
            showStatus(e.message.replace("Firebase:", ""), "red");
            loginBtn.innerText = "Login";
            loginBtn.disabled = false;
        }
    });

    // 2. SETUP MODE (Register)
    setupBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const pass = passInput.value.trim();
        
        if(loginBtn.innerText === "Login") {
            // Switch UI to Register Mode
            loginBtn.innerText = "Create Account";
            setupBtn.innerText = "Back to Login";
            loginBtn.className = "w-full bg-green-600 text-white py-3 rounded-xl font-bold text-sm shadow-lg";
            showStatus("Enter your email & set a password", "blue");
            return;
        }

        if(setupBtn.innerText === "Back to Login" && (!email || !pass)) {
             return showStatus("Enter email & new password", "red");
        }

        // PERFORM REGISTRATION
        try {
            loginBtn.innerText = "Checking Permission...";
            loginBtn.disabled = true;

            // A. Check Whitelist in Firestore
            const q = query(collection(db, "students"), where("email", "==", email));
            const snap = await getDocs(q);

            if(snap.empty) {
                throw new Error("Email not registered by Admin.");
            }

            // B. Create Auth Account
            const userCred = await createUserWithEmailAndPassword(auth, email, pass);
            const user = userCred.user;

            // C. Link Auth ID to Firestore Doc
            const preDoc = snap.docs[0];
            const data = preDoc.data();
            
            await setDoc(doc(db, "students", user.uid), {
                ...data,
                uid: user.uid,
                email: email,
                name: data.name || "Student",
                role: data.role || "student",
                approved: true
            });

            // Cleanup old doc if ID was auto-generated
            if(preDoc.id !== user.uid) await deleteDoc(doc(db, "students", preDoc.id));

            showStatus("Success! Logging in...", "green");

        } catch(e) {
            showStatus(e.message, "red");
            loginBtn.innerText = "Create Account";
            loginBtn.disabled = false;
        }
    });
}

function showStatus(msg, color) {
    statusMsg.innerText = msg;
    statusMsg.className = `text-xs text-center mt-4 font-medium h-5 text-${color}-600`;
}

// --- AUTH STATE ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Fetch User Data
        const snap = await getDoc(doc(db, "students", user.uid));
        if(snap.exists()) {
            currentUser = snap.data();
            initDashboard();
        } else {
            // Rare edge case: Auth exists but DB deleted
            signOut(auth);
            showStatus("Account deleted by Admin", "red");
        }
    } else {
        document.getElementById('login-section').classList.remove('hidden');
        document.getElementById('dashboard-section').classList.add('hidden');
    }
});

// --- DASHBOARD ---
function initDashboard() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    document.getElementById('profile-name').innerText = currentUser.name;
    document.getElementById('profile-email').innerText = currentUser.email;
    document.getElementById('profile-initial').innerText = currentUser.name.charAt(0).toUpperCase();

    if (currentUser.role === 'admin') {
        document.getElementById('admin-link-btn').classList.remove('hidden');
    }
    
    loadAnnouncement();
    loadNotes();
    loadExams();
    loadLeaderboard();
}

// --- STUDENT FEATURES ---
async function loadAnnouncement() {
    const snap = await getDoc(doc(db, "settings", "announcement"));
    if(snap.exists() && snap.data().text) {
        document.getElementById('announcement-area').classList.remove('hidden');
        document.getElementById('announcement-text').innerText = snap.data().text;
    }
}

async function loadNotes() {
    const snaps = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    allNotes = []; snaps.forEach(doc => allNotes.push(doc.data()));
    renderNotes(allNotes);
}

function renderNotes(notes) {
    const list = document.getElementById('notes-list'); list.innerHTML = "";
    if(notes.length === 0) list.innerHTML = "<p class='text-xs text-gray-400 p-4'>No notes found.</p>";
    notes.forEach(n => {
        const icon = n.type === 'pdf' ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500';
        list.innerHTML += `
        <div onclick="openViewer('${n.url}', '${n.type}')" class="bg-white p-3 rounded-xl border border-slate-100 flex items-center gap-3 active:scale-[0.98] transition cursor-pointer shadow-sm">
            <div class="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center"><i class="fas ${icon} text-lg"></i></div>
            <div class="flex-grow overflow-hidden"><h4 class="font-bold text-slate-700 text-xs truncate">${n.title}</h4><span class="text-[10px] text-slate-400 uppercase">${n.type}</span></div>
        </div>`;
    });
}

// --- EXAMS ---
async function loadExams() {
    const snaps = await getDocs(query(collection(db, "exams"), orderBy("createdAt", "desc")));
    const resSnaps = await getDocs(query(collection(db, "results"), where("studentId", "==", currentUser.uid)));
    const takenIds = []; resSnaps.forEach(doc => takenIds.push(doc.data().examId));
    
    const list = document.getElementById('exams-list'); list.innerHTML = "";
    if(snaps.empty) list.innerHTML = "<p class='text-xs text-gray-400 p-4'>No exams available.</p>";

    snaps.forEach(doc => {
        const e = doc.data();
        const isTaken = takenIds.includes(doc.id);
        list.innerHTML += `
        <div class="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg flex items-center justify-center ${isTaken?'bg-green-100 text-green-600':'bg-indigo-100 text-indigo-600'}"><i class="fas ${isTaken?'fa-check':'fa-pen'}"></i></div>
                <div><h3 class="font-bold text-slate-700 text-xs truncate w-32">${e.title}</h3><p class="text-[10px] text-slate-400">${e.duration}m • ${e.questions.length}Q</p></div>
            </div>
            ${!isTaken ? `<button onclick="startExam('${doc.id}')" class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm">Start</button>` : `<span class="text-[10px] font-bold text-green-500 bg-green-50 px-2 py-1 rounded">Done</span>`}
        </div>`;
    });
}

window.startExam = async (eid) => {
    const docSnap = await getDoc(doc(db, "exams", eid)); currentExam = {id: docSnap.id, ...docSnap.data()};
    document.getElementById('exam-taker-modal').classList.remove('hidden');
    document.getElementById('taking-exam-title').innerText = currentExam.title;
    const area = document.getElementById('exam-questions-area'); area.innerHTML = "";
    currentExam.questions.forEach((q, idx) => {
        area.innerHTML += `<div class="bg-white p-4 rounded-xl shadow-sm mb-4"><p class="font-bold text-sm mb-2 text-slate-800">Q${idx+1}. ${q.text}</p><div class="space-y-2">${q.options.map((opt, i) => `<label class="flex items-center gap-2 bg-slate-50 p-3 rounded-lg cursor-pointer hover:bg-slate-100"><input type="radio" name="q-${idx}" value="${i}"> <span class="text-xs text-slate-600">${opt}</span></label>`).join('')}</div></div>`;
    });
    let time = currentExam.duration * 60; const disp = document.getElementById('timer-display');
    examTimer = setInterval(() => { time--; const m = Math.floor(time/60); const s = time%60; disp.innerText = `${m}:${s<10?'0'+s:s}`; if(time <= 0) submitExam(); }, 1000);
};

window.submitExam = async () => {
    clearInterval(examTimer); let score=0; currentExam.questions.forEach((q, idx) => { const sel = document.querySelector(`input[name="q-${idx}"]:checked`); if(sel && parseInt(sel.value)===q.correct) score++; });
    await addDoc(collection(db, "results"), { examId: currentExam.id, examTitle: currentExam.title, studentId: currentUser.uid, studentName: currentUser.name, score, total: currentExam.questions.length, submittedAt: serverTimestamp() });
    document.getElementById('exam-taker-modal').classList.add('hidden'); alert(`Score: ${score}`); loadExams(); loadLeaderboard();
};

async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list'); list.innerHTML = "";
    const snaps = await getDocs(query(collection(db, "results"), orderBy("score", "desc"), limit(10)));
    let rank=1; snaps.forEach(doc => { const r = doc.data(); list.innerHTML += `<div class="p-3 flex justify-between items-center"><div class="flex items-center gap-3"><span class="font-bold text-slate-300 text-lg w-6 text-center">${rank++}</span><div><div class="font-bold text-xs text-slate-700">${r.studentName}</div><div class="text-[10px] text-slate-400 truncate w-32">${r.examTitle}</div></div></div><span class="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">${r.score}/${r.total}</span></div>`; });
}

// --- GLOBAL UTILS ---
window.switchTab = (tab) => {
    ['notes', 'exams', 'leaderboard'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`); const view = document.getElementById(`view-${t}`);
        view.classList.toggle('hidden', t!==tab);
        btn.className = t===tab ? "flex-1 py-2.5 text-xs font-bold rounded-lg bg-white shadow text-blue-600 transition" : "flex-1 py-2.5 text-xs font-medium rounded-lg text-gray-400 hover:bg-gray-50 transition";
    });
};

window.openViewer = (url, type) => {
    document.getElementById('viewer-modal').classList.remove('hidden');
    const wm = document.getElementById('watermark-overlay'); wm.innerHTML = ""; 
    for(let i=0;i<30;i++) wm.innerHTML += `<div class="watermark-text">${currentUser.email}</div>`;
    const pdf = document.getElementById('pdf-frame'); const img = document.getElementById('image-frame');
    if(type === 'pdf') { pdf.src = url; pdf.classList.remove('hidden'); img.classList.add('hidden'); } else { img.src = url; img.classList.remove('hidden'); pdf.classList.add('hidden'); }
};
window.closeViewer = () => { document.getElementById('viewer-modal').classList.add('hidden'); document.getElementById('pdf-frame').src = ""; };
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(() => location.reload()));
