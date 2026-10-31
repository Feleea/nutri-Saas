import { describe, expect, it } from 'vitest';
import { parsePatientCsv } from '../../src/patients/import';

describe('CSV de importação de pacientes [unit]', () => {
  it('lê BOM, campos entre aspas, vírgulas, quebras e etiquetas separadas por ponto e vírgula', () => {
    const result = parsePatientCsv('\uFEFFnome,email,telefone,cpf,objetivo,etiquetas\r\n"Ana, Silva",ana@example.test,11999990000,529.982.247-25,"Saúde\nintegral","gestante; atleta"\r\n');
    if (!result.rows) throw new Error('CSV deveria ser válido');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      row: 2,
      input: {
        fullName: 'Ana, Silva',
        email: 'ana@example.test',
        phone: '11999990000',
        cpf: '529.982.247-25',
        goal: 'Saúde\nintegral',
        tags: ['gestante', 'atleta'],
      },
      errors: [],
    });
  });

  it('reporta campos inválidos por linha sem ocultar outras linhas', () => {
    const result = parsePatientCsv('nome,email,telefone\nAna,,11999990000\n,xx,12\n');
    if (!result.rows) throw new Error('CSV deveria ser válido');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[1].errors).toEqual(expect.arrayContaining(['name_required', 'email_invalid', 'phone_invalid']));
  });

  it('recusa CSV malformado, cabeçalhos ambíguos e excesso de linhas', () => {
    expect(parsePatientCsv('nome,email\n"Ana,ana@example.test').error).toBe('csv_invalid');
    expect(parsePatientCsv('nome,name\nAna,Ana').error).toBe('header_invalid');
    const tooManyRows = `nome,telefone\n${Array.from({ length: 201 }, () => 'Ana,11999990000').join('\n')}`;
    expect(parsePatientCsv(tooManyRows).error).toBe('too_many_rows');
  });
});
