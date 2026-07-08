const fs = require('fs');
let code = fs.readFileSync('src/components/ExecutionEngine.tsx', 'utf8');

const target = `  useEffect(() => {
    if (!auth.currentUser) return;

    const loadPrefs = async () => {
      try {
        const docRef = doc(db, \`users/\${auth.currentUser?.uid}/preferences\`, 'settings');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setPreferences(docSnap.data() as UserPreferences);
        } else {
          await setDoc(docRef, DEFAULT_PREFERENCES);
        }
      } catch (err) {
        console.warn('Error loading preferences:', err);
      }
    };
    loadPrefs();
  }, []);`;

const replacement = `  useEffect(() => {
    if (!auth.currentUser) return;

    const loadPrefs = async () => {
      try {
        const docRef = doc(db, \`users/\${auth.currentUser?.uid}/preferences\`, 'settings');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const loadedPrefs = docSnap.data() as UserPreferences;
          setPreferences(loadedPrefs);
          if (loadedPrefs.positionSize) {
            setPositionSize(loadedPrefs.positionSize);
          }
        } else {
          await setDoc(docRef, DEFAULT_PREFERENCES);
        }
      } catch (err) {
        console.warn('Error loading preferences:', err);
      }
    };
    loadPrefs();
    
    const loadState = async () => {
      try {
        const docRef = doc(db, \`users/\${auth.currentUser?.uid}/executionState\`, 'currentTrade');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && !docSnap.data().empty) {
          const trade = docSnap.data() as SimulatedTrade;
          currentTradeRef.current = trade;
          setCurrentTrade(trade);
          setStep(3); // Resume at position tracking
        }
      } catch (e) {
        console.warn('Failed to load active trade', e);
      }
    };
    loadState();
  }, []);`;

if(code.includes(target)){
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/ExecutionEngine.tsx', code);
  console.log("Replaced");
} else {
  console.log("Not found");
}
