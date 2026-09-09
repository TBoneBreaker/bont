import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, IconButton, Modal } from '../../components/ui'
import { getUserMessage } from '../../lib/errors'
import type { MealSlot } from '../../types'
import { addMeal, deleteMeal, renameMeal } from './commands'

export function MealManager({ open, meals, userId, onClose }: { open: boolean; meals: MealSlot[]; userId: string; onClose: () => void }) {
  const [error, setError] = useState('')

  async function rename(meal: MealSlot, name: string) {
    try {
      setError('')
      await renameMeal(userId, meal, name)
    } catch (renameError) {
      setError(getUserMessage(renameError, 'Die Mahlzeit konnte nicht umbenannt werden.'))
    }
  }

  async function add() {
    try {
      setError('')
      await addMeal(userId, meals.length)
    } catch (addError) {
      setError(getUserMessage(addError, 'Die Mahlzeit konnte nicht angelegt werden.'))
    }
  }

  async function remove(meal: MealSlot) {
    if (meals.length <= 1) return
    try {
      setError('')
      await deleteMeal(userId, meal)
    } catch (removeError) {
      setError(getUserMessage(removeError, 'Die Mahlzeit konnte nicht gelöscht werden.'))
    }
  }

  return (
    <Modal open={open} title="Mahlzeiten anpassen" onClose={onClose}>
      <p className="small muted">Bis zu zehn Mahlzeiten. Änderungen werden direkt gespeichert.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="stack stack--tight">
        {meals.map((meal) => (
          <div className="meal-edit-row" key={meal.id}>
            <input aria-label="Name der Mahlzeit" defaultValue={meal.name} maxLength={40} onBlur={(event) => { void rename(meal, event.currentTarget.value); event.currentTarget.value = event.currentTarget.value.trim() }} />
            <IconButton label="Mahlzeit entfernen" disabled={meals.length <= 1} onClick={() => void remove(meal)}><Trash2 size={17} /></IconButton>
          </div>
        ))}
      </div>
      <Button variant="secondary" full disabled={meals.length >= 10} onClick={() => void add()}><Plus size={18} /> Mahlzeit hinzufügen ({meals.length}/10)</Button>
      <Button full onClick={onClose}>Fertig</Button>
    </Modal>
  )
}
