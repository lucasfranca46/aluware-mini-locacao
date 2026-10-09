-- =============================================================================
-- Leitura pública restrita às colunas que a tela usa
-- =============================================================================
-- A anon key vai no JavaScript do site, então tudo que o papel `anon` consegue
-- ler é, na prática, público. Antes desta migration, `select * from clientes`
-- devolvia CPF, e-mail e telefone.
--
-- Agora os papéis da API (anon/authenticated) só leem, por privilégio de
-- coluna, o necessário para montar a vw_faturas. CPF, e-mail, telefone, cor,
-- ano e afins deixam de ser acessíveis. A view continua com
-- security_invoker = true: ela respeita as permissões de quem consulta, sem
-- precisar de uma view "security definer".
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.clientes, public.veiculos, public.contratos, public.faturas
      from anon, authenticated;

    grant select (id, nome)                                on public.clientes  to anon, authenticated;
    grant select (id, modelo, placa)                       on public.veiculos  to anon, authenticated;
    grant select (id, cliente_id, veiculo_id, qtd_semanas) on public.contratos to anon, authenticated;
    grant select (id, codigo, contrato_id, parcela, vencimento, valor, status, pago_em, pago_em_brt)
                                                           on public.faturas   to anon, authenticated;

    revoke all on public.vw_faturas from anon, authenticated;
    grant select on public.vw_faturas to anon, authenticated;
  end if;
end;
$$;
