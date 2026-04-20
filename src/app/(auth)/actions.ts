'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signIn(formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email:    String(formData.get('email')),
    password: String(formData.get('password')),
  })

  if (error) return { error: error.message }

  redirect('/')
}

export async function signUp(formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase.auth.signUp({
    email:    String(formData.get('email')),
    password: String(formData.get('password')),
    options: {
      data: {
        restaurant_name: String(formData.get('restaurant_name')),
      },
    },
  })

  if (error) return { error: error.message }

  return { success: true }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
