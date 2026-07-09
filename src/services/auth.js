import { auth, db } from '../firebase'
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'

const provider = new GoogleAuthProvider()
provider.setCustomParameters({ prompt: 'select_account' })

// Subscribe to auth state. Fires immediately with the restored session (or null) and on every
// login/logout. Returns an unsubscribe function.
export function subscribeAuth(cb) {
  return onAuthStateChanged(auth, cb)
}

export async function signInWithGoogle() {
  const { user } = await signInWithPopup(auth, provider)
  // Record the user (so the backend can map an email → uid for the digest, and for a users list).
  await setDoc(
    doc(db, 'users', user.uid),
    {
      uid: user.uid,
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      lastSeen: serverTimestamp(),
    },
    { merge: true },
  )
  return user
}

export function signOutUser() {
  return signOut(auth)
}
