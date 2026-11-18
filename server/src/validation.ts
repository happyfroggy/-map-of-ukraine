import { z, type ZodError } from 'zod';

const name = (label: string) =>
  z.string({ error: `Вкажіть ${label}` })
    .trim()
    .min(1, `Вкажіть ${label}`)
    .max(50, `Поле «${label}» задовге`);

export const roomCodeSchema = z
  .string({ error: 'Вкажіть код кімнати' })
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{4,8}$/, 'Некоректний код кімнати'));

export const joinSchema = z.object({
  roomCode: roomCodeSchema,
  firstName: name("ім'я"),
  lastName: name('прізвище'),
});
export const resumeSchema = z.object({ token: z.string().min(1).max(100) });
export const roomSchema = z.object({ roomCode: roomCodeSchema });
export const openRegionSchema = z.object({ regionId: z.string().min(1).max(50) });
export const answerSchema = z.object({
  regionId: z.string().min(1).max(50),
  questionId: z.number().int().positive(),
  answer: z.union([z.number().int().min(0).max(3), z.string().max(200)]),
});
export const loginSchema = z.object({ password: z.string().min(1, 'Вкажіть пароль').max(200) });

const text = (max: number, msg: string) => z.string().trim().min(1, msg).max(max);
const questionBase = {
  regionId: z.string().min(1, 'Оберіть регіон'),
  prompt: text(500, 'Вкажіть текст питання'),
};
export const questionInputSchema = z.discriminatedUnion('type', [
  z.object({
    ...questionBase,
    type: z.literal('choice'),
    options: z.array(text(200, 'Варіант відповіді не може бути порожнім')).length(4, 'Потрібно рівно 4 варіанти'),
    correctIndex: z.number().int().min(0).max(3, 'Оберіть правильний варіант'),
  }),
  z.object({
    ...questionBase,
    type: z.literal('text'),
    acceptedAnswers: z.array(text(200, 'Відповідь не може бути порожньою')).min(1, 'Вкажіть правильну відповідь').max(10),
  }),
]);

export const idParamSchema = z.coerce.number().int().positive();

export function formatZodError(err: ZodError): string {
  return err.issues[0]?.message ?? 'Некоректні дані';
}
